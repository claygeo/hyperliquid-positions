// Signal Generator - Detects convergence among quality traders

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';

const logger = createLogger('signal-generator');

// ============================================
// Types
// ============================================

interface PositionWithTrader {
  address: string;
  coin: string;
  direction: string;
  size: number;
  entry_price: number;
  value_usd: number;
  leverage: number;
  unrealized_pnl: number;
  quality_tier: string;
  pnl_7d: number;
  win_rate: number;
  account_value: number;
}

interface TraderInfo {
  address: string;
  tier: string;
  pnl_7d: number;
  win_rate: number;
  position_value: number;
  entry_price: number;
  leverage: number;
  unrealized_pnl: number;
}

interface SignalData {
  coin: string;
  direction: string;
  elite_count: number;
  good_count: number;
  total_traders: number;
  combined_pnl_7d: number;
  combined_account_value: number;
  avg_win_rate: number;
  total_position_value: number;
  avg_entry_price: number;
  avg_leverage: number;
  traders: TraderInfo[];
  signal_strength: 'strong' | 'medium';
}

// ============================================
// Signal Logic
// ============================================

function meetsSignalRequirements(eliteCount: number, goodCount: number): boolean {
  // 2+ elite = signal
  if (eliteCount >= config.signals.minEliteForSignal) return true;
  
  // 3+ good = signal
  if (goodCount >= config.signals.minGoodForSignal) return true;
  
  // 1 elite + 2 good = signal
  if (eliteCount >= config.signals.minMixedForSignal.elite && 
      goodCount >= config.signals.minMixedForSignal.good) return true;
  
  return false;
}

function calculateSignalStrength(eliteCount: number, goodCount: number): 'strong' | 'medium' {
  // Strong: 3+ elite OR (2+ elite AND 2+ good)
  if (eliteCount >= 3) return 'strong';
  if (eliteCount >= 2 && goodCount >= 2) return 'strong';
  
  return 'medium';
}

// ============================================
// Main Generator
// ============================================

export async function generateSignals(): Promise<void> {
  // Get all positions with trader quality info
  const result = await db.client
    .from('trader_positions')
    .select(`
      address,
      coin,
      direction,
      size,
      entry_price,
      value_usd,
      leverage,
      unrealized_pnl
    `);
  
  if (result.error || !result.data) {
    logger.error('Failed to fetch positions', result.error);
    return;
  }
  
  const positions = result.data as any[];
  
  // Get quality info for all traders with positions
  const addresses = [...new Set(positions.map(p => p.address))];
  
  if (addresses.length === 0) {
    return;
  }
  
  const qualityResult = await db.client
    .from('trader_quality')
    .select('address, quality_tier, pnl_7d, win_rate, account_value')
    .in('address', addresses);
  
  if (qualityResult.error) {
    logger.error('Failed to fetch quality data', qualityResult.error);
    return;
  }
  
  const qualityMap = new Map(
    (qualityResult.data || []).map((q: any) => [q.address, q])
  );
  
  // Combine position and quality data
  const positionsWithQuality: PositionWithTrader[] = positions
    .map(p => {
      const quality = qualityMap.get(p.address);
      if (!quality) return null;
      return {
        ...p,
        quality_tier: quality.quality_tier,
        pnl_7d: quality.pnl_7d,
        win_rate: quality.win_rate,
        account_value: quality.account_value,
      };
    })
    .filter((p): p is PositionWithTrader => p !== null);
  
  // Group by coin + direction
  const groups = new Map<string, PositionWithTrader[]>();
  
  for (const pos of positionsWithQuality) {
    const key = `${pos.coin}:${pos.direction}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(pos);
  }
  
  // Track which signals we create
  const activeSignalKeys = new Set<string>();
  
  // Check each group for convergence
  for (const [key, groupPositions] of groups) {
    const [coin, direction] = key.split(':');
    
    // Count by tier
    const elites = groupPositions.filter(p => p.quality_tier === 'elite');
    const goods = groupPositions.filter(p => p.quality_tier === 'good');
    
    const eliteCount = elites.length;
    const goodCount = goods.length;
    
    // Check if meets signal requirements
    if (!meetsSignalRequirements(eliteCount, goodCount)) {
      continue;
    }
    
    activeSignalKeys.add(key);
    
    // Calculate aggregates
    const allTraders = [...elites, ...goods];
    const totalTraders = allTraders.length;
    
    const combinedPnl = allTraders.reduce((sum, t) => sum + (t.pnl_7d || 0), 0);
    const combinedAccountValue = allTraders.reduce((sum, t) => sum + (t.account_value || 0), 0);
    const avgWinRate = allTraders.reduce((sum, t) => sum + (t.win_rate || 0), 0) / totalTraders;
    const totalPositionValue = allTraders.reduce((sum, t) => sum + (t.value_usd || 0), 0);
    const avgEntryPrice = allTraders.reduce((sum, t) => sum + (t.entry_price || 0), 0) / totalTraders;
    const avgLeverage = allTraders.reduce((sum, t) => sum + (t.leverage || 1), 0) / totalTraders;
    
    // Prepare trader details (sorted: elite first, then by PnL)
    const traders: TraderInfo[] = allTraders
      .sort((a, b) => {
        if (a.quality_tier === 'elite' && b.quality_tier !== 'elite') return -1;
        if (a.quality_tier !== 'elite' && b.quality_tier === 'elite') return 1;
        return (b.pnl_7d || 0) - (a.pnl_7d || 0);
      })
      .map(t => ({
        address: t.address,
        tier: t.quality_tier,
        pnl_7d: t.pnl_7d,
        win_rate: t.win_rate,
        position_value: t.value_usd,
        entry_price: t.entry_price,
        leverage: t.leverage,
        unrealized_pnl: t.unrealized_pnl,
      }));
    
    const signalStrength = calculateSignalStrength(eliteCount, goodCount);
    
    // Upsert signal
    const expiresAt = new Date(Date.now() + config.signals.expiryHours * 60 * 60 * 1000);
    
    await db.client
      .from('quality_signals')
      .upsert({
        coin,
        direction,
        elite_count: eliteCount,
        good_count: goodCount,
        total_traders: totalTraders,
        combined_pnl_7d: combinedPnl,
        combined_account_value: combinedAccountValue,
        avg_win_rate: avgWinRate,
        total_position_value: totalPositionValue,
        avg_entry_price: avgEntryPrice,
        avg_leverage: avgLeverage,
        traders: traders,
        signal_strength: signalStrength,
        is_active: true,
        expires_at: expiresAt.toISOString(),
      }, { onConflict: 'coin,direction' });
    
    logger.info(`Signal: ${coin} ${direction.toUpperCase()} | ${eliteCount}E + ${goodCount}G | $${Math.round(combinedPnl).toLocaleString()} 7d PnL | ${signalStrength.toUpperCase()}`);
  }
  
  // Deactivate signals that no longer meet requirements
  const allSignals = await db.client
    .from('quality_signals')
    .select('coin, direction')
    .eq('is_active', true);
  
  if (allSignals.data) {
    for (const signal of allSignals.data) {
      const key = `${signal.coin}:${signal.direction}`;
      if (!activeSignalKeys.has(key)) {
        await db.client
          .from('quality_signals')
          .update({ is_active: false })
          .eq('coin', signal.coin)
          .eq('direction', signal.direction);
        
        logger.info(`Signal expired: ${signal.coin} ${signal.direction}`);
      }
    }
  }
  
  // Also expire old signals
  await db.client
    .from('quality_signals')
    .update({ is_active: false })
    .lt('expires_at', new Date().toISOString());
}

// ============================================
// Public API
// ============================================

export async function getActiveSignals(): Promise<any[]> {
  const result = await db.client
    .from('quality_signals')
    .select('*')
    .eq('is_active', true)
    .gt('expires_at', new Date().toISOString())
    .order('elite_count', { ascending: false })
    .order('total_traders', { ascending: false });
  
  return result.data || [];
}

export default { generateSignals, getActiveSignals };