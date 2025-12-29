// Signal Generator - Creates signals when quality traders converge

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';

const logger = createLogger('signal-generator');

// Signal requirements
const MIN_ELITE_FOR_SIGNAL = 2;
const MIN_GOOD_FOR_SIGNAL = 3;
const MIN_TOTAL_FOR_SIGNAL = 2;
const SIGNAL_EXPIRY_HOURS = 4;

interface TraderPosition {
  address: string;
  coin: string;
  direction: string;
  entry_price: number;
  value_usd: number;
  unrealized_pnl: number;
}

interface TraderQuality {
  address: string;
  quality_tier: string;
  pnl_7d: number;
  win_rate: number;
}

interface ConvergenceGroup {
  coin: string;
  direction: string;
  traders: Array<{
    address: string;
    tier: string;
    pnl_7d: number;
    win_rate: number;
    position_value: number;
    entry_price: number;
  }>;
  eliteCount: number;
  goodCount: number;
  totalValue: number;
  avgEntryPrice: number;
  combinedPnl7d: number;
  avgWinRate: number;
}

export async function generateSignals(): Promise<void> {
  // Get all current positions with quality data
  const positionsResult = await db.client
    .from('trader_positions')
    .select('address, coin, direction, entry_price, value_usd, unrealized_pnl');
  
  if (positionsResult.error || !positionsResult.data) {
    logger.error('Failed to fetch positions', positionsResult.error);
    return;
  }
  
  const positions = positionsResult.data as TraderPosition[];
  
  if (positions.length === 0) return;
  
  // Get quality data for all traders
  const addresses = [...new Set(positions.map(p => p.address))];
  
  const qualityResult = await db.client
    .from('trader_quality')
    .select('address, quality_tier, pnl_7d, win_rate')
    .in('address', addresses);
  
  if (qualityResult.error || !qualityResult.data) {
    return;
  }
  
  const qualityMap = new Map<string, TraderQuality>();
  for (const q of qualityResult.data as TraderQuality[]) {
    qualityMap.set(q.address, q);
  }
  
  // Group positions by coin + direction
  const groups = new Map<string, ConvergenceGroup>();
  
  for (const pos of positions) {
    const key = pos.coin + '_' + pos.direction;
    const quality = qualityMap.get(pos.address);
    
    if (!quality) continue;
    
    let group = groups.get(key);
    if (!group) {
      group = {
        coin: pos.coin,
        direction: pos.direction,
        traders: [],
        eliteCount: 0,
        goodCount: 0,
        totalValue: 0,
        avgEntryPrice: 0,
        combinedPnl7d: 0,
        avgWinRate: 0,
      };
      groups.set(key, group);
    }
    
    group.traders.push({
      address: pos.address,
      tier: quality.quality_tier,
      pnl_7d: quality.pnl_7d,
      win_rate: quality.win_rate,
      position_value: pos.value_usd,
      entry_price: pos.entry_price,
    });
    
    if (quality.quality_tier === 'elite') {
      group.eliteCount++;
    } else if (quality.quality_tier === 'good') {
      group.goodCount++;
    }
    
    group.totalValue += pos.value_usd;
    group.avgEntryPrice += pos.entry_price;
    group.combinedPnl7d += quality.pnl_7d;
    group.avgWinRate += quality.win_rate;
  }
  
  // Process each group and create/update signals
  let signalsCreated = 0;
  let signalsUpdated = 0;
  
  for (const [key, group] of groups) {
    const traderCount = group.traders.length;
    
    // Calculate averages
    if (traderCount > 0) {
      group.avgEntryPrice = group.avgEntryPrice / traderCount;
      group.avgWinRate = group.avgWinRate / traderCount;
    }
    
    // Check if this qualifies as a signal
    const hasEnoughElite = group.eliteCount >= MIN_ELITE_FOR_SIGNAL;
    const hasEnoughGood = group.goodCount >= MIN_GOOD_FOR_SIGNAL;
    const hasEnoughTotal = traderCount >= MIN_TOTAL_FOR_SIGNAL;
    
    // Signal requires: 2+ ELITE, OR 3+ GOOD, OR significant total
    const qualifiesForSignal = hasEnoughElite || hasEnoughGood || (hasEnoughTotal && group.eliteCount >= 1);
    
    if (!qualifiesForSignal) {
      // Deactivate any existing signal for this coin/direction
      await db.client
        .from('quality_signals')
        .update({ is_active: false })
        .eq('coin', group.coin)
        .eq('direction', group.direction)
        .eq('is_active', true);
      continue;
    }
    
    // Determine signal strength
    let signalStrength = 'medium';
    if (group.eliteCount >= 3 || (group.eliteCount >= 2 && group.goodCount >= 2)) {
      signalStrength = 'strong';
    }
    
    // Sort traders by tier (elite first) then by pnl_7d
    group.traders.sort((a, b) => {
      if (a.tier === 'elite' && b.tier !== 'elite') return -1;
      if (a.tier !== 'elite' && b.tier === 'elite') return 1;
      return b.pnl_7d - a.pnl_7d;
    });
    
    // Check if signal already exists
    const existingResult = await db.client
      .from('quality_signals')
      .select('id')
      .eq('coin', group.coin)
      .eq('direction', group.direction)
      .eq('is_active', true)
      .single();
    
    const signalData = {
      coin: group.coin,
      direction: group.direction,
      elite_count: group.eliteCount,
      good_count: group.goodCount,
      total_traders: traderCount,
      traders: group.traders,
      combined_pnl_7d: group.combinedPnl7d,
      avg_win_rate: group.avgWinRate,
      total_position_value: group.totalValue,
      avg_entry_price: group.avgEntryPrice,
      signal_strength: signalStrength,
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + SIGNAL_EXPIRY_HOURS * 60 * 60 * 1000).toISOString(),
      is_active: true,
    };
    
    if (existingResult.data) {
      // Update existing signal
      await db.client
        .from('quality_signals')
        .update(signalData)
        .eq('id', existingResult.data.id);
      
      signalsUpdated++;
    } else {
      // Create new signal
      const insertResult = await db.client
        .from('quality_signals')
        .insert({
          ...signalData,
          created_at: new Date().toISOString(),
        });
      
      if (!insertResult.error) {
        signalsCreated++;
        
        // Log new signal
        logger.info('');
        logger.info('='.repeat(60));
        logger.info('NEW SIGNAL: ' + group.coin + ' ' + group.direction.toUpperCase() + ' [' + signalStrength.toUpperCase() + ']');
        logger.info('Traders: ' + group.eliteCount + ' Elite + ' + group.goodCount + ' Good = ' + traderCount + ' total');
        logger.info('Combined 7d PnL: $' + Math.round(group.combinedPnl7d).toLocaleString());
        logger.info('Avg Win Rate: ' + (group.avgWinRate * 100).toFixed(1) + '%');
        logger.info('Total Value: $' + Math.round(group.totalValue).toLocaleString());
        logger.info('='.repeat(60));
        logger.info('');
      }
    }
  }
  
  // Expire old signals
  await db.client
    .from('quality_signals')
    .update({ is_active: false })
    .eq('is_active', true)
    .lt('expires_at', new Date().toISOString());
  
  if (signalsCreated > 0 || signalsUpdated > 0) {
    logger.info('Signals: ' + signalsCreated + ' new, ' + signalsUpdated + ' updated');
  }
}

export async function getActiveSignals(): Promise<any[]> {
  const result = await db.client
    .from('quality_signals')
    .select('*')
    .eq('is_active', true)
    .order('elite_count', { ascending: false })
    .order('total_traders', { ascending: false });
  
  return result.data || [];
}

export default { generateSignals, getActiveSignals };
