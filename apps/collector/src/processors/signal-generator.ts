// Signal Generator V2 - Detects convergence among quality traders
// V2 Changes:
// - Lowered convergence requirements (quality bar is now higher)
// - 1 Elite = signal (they're rare and proven)
// - 2 Good = signal (good is now actually good)
// - Better strength calculation

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';

const logger = createLogger('signal-generator');

// ============================================
// V2 Signal Thresholds
// ============================================

const SIGNAL_REQUIREMENTS = {
  // Minimum for ANY signal
  minEliteAlone: 1,      // 1 elite alone = signal (was 2)
  minGoodAlone: 2,       // 2 good alone = signal (was 3)
  
  // Mixed requirements
  minEliteMixed: 1,      // 1 elite + good = signal
  minGoodMixed: 1,       // elite + 1 good = signal
  
  // Strong signal thresholds
  strongElite: 2,        // 2+ elite = strong
  strongGood: 4,         // 4+ good = strong
  strongMixed: { elite: 1, good: 2 }, // 1E + 2G = strong
};

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
  pnl_30d: number;
  win_rate: number;
  profit_factor: number;
  account_value: number;
}

interface TraderInfo {
  address: string;
  tier: string;
  pnl_7d: number;
  pnl_30d: number;
  win_rate: number;
  profit_factor: number;
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
  combined_pnl_30d: number;
  combined_account_value: number;
  avg_win_rate: number;
  avg_profit_factor: number;
  total_position_value: number;
  avg_entry_price: number;
  avg_leverage: number;
  traders: TraderInfo[];
  signal_strength: 'strong' | 'medium';
}

// ============================================
// V2 Signal Logic
// ============================================

function meetsSignalRequirements(eliteCount: number, goodCount: number): boolean {
  const req = SIGNAL_REQUIREMENTS;
  
  // 1+ elite = signal (they're rare and proven profitable)
  if (eliteCount >= req.minEliteAlone) return true;
  
  // 2+ good = signal (V2 "good" is actually good now)
  if (goodCount >= req.minGoodAlone) return true;
  
  // Mixed: 1 elite + 1 good = signal
  if (eliteCount >= req.minEliteMixed && goodCount >= req.minGoodMixed) return true;
  
  return false;
}

function calculateSignalStrength(eliteCount: number, goodCount: number): 'strong' | 'medium' {
  const req = SIGNAL_REQUIREMENTS;
  
  // Strong: 2+ elite
  if (eliteCount >= req.strongElite) return 'strong';
  
  // Strong: 1 elite + 2 good
  if (eliteCount >= req.strongMixed.elite && goodCount >= req.strongMixed.good) return 'strong';
  
  // Strong: 4+ good
  if (goodCount >= req.strongGood) return 'strong';
  
  return 'medium';
}

// Calculate confidence score (0-100)
function calculateConfidence(
  eliteCount: number,
  goodCount: number,
  avgWinRate: number,
  avgProfitFactor: number,
  totalPositionValue: number
): number {
  let confidence = 0;
  
  // Elite traders (up to 40 points)
  confidence += Math.min(40, eliteCount * 20);
  
  // Good traders (up to 30 points)
  confidence += Math.min(30, goodCount * 10);
  
  // Win rate bonus (up to 15 points)
  if (avgWinRate >= 0.60) confidence += 15;
  else if (avgWinRate >= 0.55) confidence += 10;
  else if (avgWinRate >= 0.50) confidence += 5;
  
  // Profit factor bonus (up to 10 points)
  if (avgProfitFactor >= 2.0) confidence += 10;
  else if (avgProfitFactor >= 1.5) confidence += 7;
  else if (avgProfitFactor >= 1.2) confidence += 4;
  
  // Position size bonus (up to 5 points)
  if (totalPositionValue >= 500000) confidence += 5;
  else if (totalPositionValue >= 100000) confidence += 3;
  else if (totalPositionValue >= 50000) confidence += 1;
  
  return Math.min(100, confidence);
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
    .select('address, quality_tier, pnl_7d, pnl_30d, win_rate, profit_factor, account_value')
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
      // Only include elite and good traders
      if (quality.quality_tier !== 'elite' && quality.quality_tier !== 'good') return null;
      return {
        ...p,
        quality_tier: quality.quality_tier,
        pnl_7d: quality.pnl_7d || 0,
        pnl_30d: quality.pnl_30d || 0,
        win_rate: quality.win_rate || 0,
        profit_factor: quality.profit_factor || 0,
        account_value: quality.account_value || 0,
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
    
    // Check if meets V2 signal requirements
    if (!meetsSignalRequirements(eliteCount, goodCount)) {
      continue;
    }
    
    activeSignalKeys.add(key);
    
    // Calculate aggregates
    const allTraders = [...elites, ...goods];
    const totalTraders = allTraders.length;
    
    const combinedPnl7d = allTraders.reduce((sum, t) => sum + (t.pnl_7d || 0), 0);
    const combinedPnl30d = allTraders.reduce((sum, t) => sum + (t.pnl_30d || 0), 0);
    const combinedAccountValue = allTraders.reduce((sum, t) => sum + (t.account_value || 0), 0);
    const avgWinRate = allTraders.reduce((sum, t) => sum + (t.win_rate || 0), 0) / totalTraders;
    const avgProfitFactor = allTraders.reduce((sum, t) => sum + (t.profit_factor || 0), 0) / totalTraders;
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
        pnl_30d: t.pnl_30d,
        win_rate: t.win_rate,
        profit_factor: t.profit_factor,
        position_value: t.value_usd,
        entry_price: t.entry_price,
        leverage: t.leverage,
        unrealized_pnl: t.unrealized_pnl,
      }));
    
    const signalStrength = calculateSignalStrength(eliteCount, goodCount);
    const confidence = calculateConfidence(
      eliteCount,
      goodCount,
      avgWinRate,
      avgProfitFactor,
      totalPositionValue
    );
    
    // Upsert signal
    const expiresAt = new Date(Date.now() + (config.signals?.expiryHours || 4) * 60 * 60 * 1000);
    
    await db.client
      .from('quality_signals')
      .upsert({
        coin,
        direction,
        elite_count: eliteCount,
        good_count: goodCount,
        total_traders: totalTraders,
        combined_pnl_7d: combinedPnl7d,
        combined_pnl_30d: combinedPnl30d,
        combined_account_value: combinedAccountValue,
        avg_win_rate: avgWinRate,
        avg_profit_factor: avgProfitFactor,
        total_position_value: totalPositionValue,
        avg_entry_price: avgEntryPrice,
        avg_leverage: avgLeverage,
        traders: traders,
        signal_strength: signalStrength,
        confidence: confidence,
        is_active: true,
        expires_at: expiresAt.toISOString(),
      }, { onConflict: 'coin,direction' });
    
    // Enhanced logging
    const pnlStr = combinedPnl7d >= 0 ? `+$${Math.round(combinedPnl7d).toLocaleString()}` : `-$${Math.abs(Math.round(combinedPnl7d)).toLocaleString()}`;
    logger.info(
      `Signal: ${coin} ${direction.toUpperCase()} | ` +
      `${eliteCount}E + ${goodCount}G | ` +
      `${pnlStr} 7d PnL | ` +
      `${(avgWinRate * 100).toFixed(0)}% WR | ` +
      `${avgProfitFactor.toFixed(1)} PF | ` +
      `${signalStrength.toUpperCase()} (${confidence}%)`
    );
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
  
  // Also expire old signals by time
  await db.client
    .from('quality_signals')
    .update({ is_active: false })
    .lt('expires_at', new Date().toISOString());
    
  // Log summary
  if (activeSignalKeys.size > 0) {
    logger.info(`Active signals: ${activeSignalKeys.size}`);
  }
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
    .order('confidence', { ascending: false })
    .order('total_traders', { ascending: false });
  
  return result.data || [];
}

export async function getSignalByAsset(coin: string, direction: string): Promise<any | null> {
  const result = await db.client
    .from('quality_signals')
    .select('*')
    .eq('coin', coin)
    .eq('direction', direction)
    .eq('is_active', true)
    .single();
  
  return result.data || null;
}

export default { generateSignals, getActiveSignals, getSignalByAsset };