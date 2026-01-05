// Signal Generator V12
// CHANGES FROM V11:
// - NEW: Tracks per-trader exit data (exit_price, exited_at, exit_type)
// - When a trader closes their position, we capture their exit price/time
// - When signal closes, any remaining traders get exit data populated
// - This enables accurate per-trader P&L display in track record
//
// ARCHITECTURE:
// - EVENT-DRIVEN: Only creates signals when we WITNESS a position open
// - VERIFIED: Every signal has entry_detected_at = when WE saw the open
// - EXIT TRACKING: Each trader has exit_price, exited_at, exit_type

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import hyperliquid from '../utils/hyperliquid-api.js';
import { PositionChange, subscribeToPositionChanges } from './position-tracker.js';
import { getSignalFundingContext } from './funding-tracker.js';

const logger = createLogger('signal-generator-v12');

// ============================================
// Types
// ============================================

type SignalTier = 'elite_entry' | 'confirmed' | 'consensus';
type ExitType = 'manual' | 'stopped' | 'liquidated' | 'signal_closed' | null;

interface TraderQuality {
  address: string;
  quality_tier: 'elite' | 'good' | 'weak';
  pnl_7d: number;
  pnl_30d: number;
  win_rate: number;
  profit_factor: number;
  account_value: number;
}

interface PositionAddition {
  size_added: number;
  price_at_add: number;
  new_entry_price: number;
  new_size: number;
  value_usd: number;
  detected_at: string;
}

interface TraderForSignal {
  address: string;
  tier: 'elite' | 'good';
  pnl_7d: number;
  pnl_30d: number;
  win_rate: number;
  profit_factor: number;
  entry_price: number;
  position_value: number;
  leverage: number;
  liquidation_price: number | null;
  conviction_pct: number;
  has_stop_order: boolean;
  opened_at: string;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  additions: PositionAddition[];
  // V12: Exit tracking fields
  exit_price: number | null;
  exited_at: string | null;
  exit_type: ExitType;
}

interface ActiveSignal {
  id: number;
  coin: string;
  direction: string;
  elite_count: number;
  good_count: number;
  total_traders: number;
  created_at: string;
  entry_price: number;
  entry_detected_at: string;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  take_profit_3: number;
  is_active: boolean;
  confidence: number;
  traders: TraderForSignal[];
  trigger_event_id: number;
  signal_tier: SignalTier;
}

// ============================================
// Signal Tier Determination
// ============================================

function determineSignalTier(eliteCount: number, goodCount: number): SignalTier {
  // Consensus: 3+ elite OR 2+ elite with 2+ good
  if (eliteCount >= 3 || (eliteCount >= 2 && goodCount >= 2)) {
    return 'consensus';
  }
  
  // Confirmed: 2 elite OR 1 elite + 1 good OR 3+ good
  if (eliteCount >= 2 || (eliteCount >= 1 && goodCount >= 1) || goodCount >= 3) {
    return 'confirmed';
  }
  
  // Elite Entry: 1 elite (no good traders needed)
  if (eliteCount >= 1) {
    return 'elite_entry';
  }
  
  // Should not reach here if signal requirements are met
  return 'elite_entry';
}

function shouldCreateSignal(eliteCount: number, goodCount: number): boolean {
  // V11: Create signal with just 1 elite trader
  if (eliteCount >= 1) return true;
  
  // Still require 3+ good for good-only signals (they need validation)
  if (goodCount >= 3) return true;
  
  return false;
}

// ============================================
// Volatility-Based Stop Configuration
// ============================================

function calculateDynamicStopDistance(
  atrPct: number,
  volatilityRank: number
): { minStop: number; maxStop: number; multiplier: number } {
  if (volatilityRank >= 80) {
    return { minStop: 10, maxStop: 25, multiplier: 2.5 };
  } else if (volatilityRank >= 60) {
    return { minStop: 7, maxStop: 15, multiplier: 2.0 };
  } else if (volatilityRank >= 40) {
    return { minStop: 5, maxStop: 12, multiplier: 2.0 };
  } else if (volatilityRank >= 20) {
    return { minStop: 4, maxStop: 10, multiplier: 1.75 };
  } else {
    return { minStop: 3, maxStop: 8, multiplier: 1.5 };
  }
}

// ============================================
// Helper Functions
// ============================================

async function getTraderQuality(address: string): Promise<TraderQuality | null> {
  const { data } = await db.client
    .from('trader_quality')
    .select('address, quality_tier, pnl_7d, pnl_30d, win_rate, profit_factor, account_value')
    .eq('address', address)
    .eq('is_tracked', true)
    .single();

  return data as TraderQuality | null;
}

async function getTraderPosition(address: string, coin: string) {
  const { data } = await db.client
    .from('trader_positions')
    .select('*')
    .eq('address', address)
    .eq('coin', coin)
    .single();

  return data;
}

async function getActiveSignalForCoin(coin: string, direction: string): Promise<ActiveSignal | null> {
  const { data } = await db.client
    .from('quality_signals')
    .select('*')
    .eq('coin', coin)
    .eq('direction', direction)
    .eq('is_active', true)
    .single();

  return data as ActiveSignal | null;
}

async function getPositionAdditions(address: string, coin: string, direction: string, since?: string): Promise<PositionAddition[]> {
  let query = db.client
    .from('position_history')
    .select('*')
    .eq('address', address)
    .eq('coin', coin)
    .eq('direction', direction)
    .eq('event_type', 'increase')
    .order('detected_at', { ascending: true });

  if (since) {
    query = query.gte('detected_at', since);
  }

  const { data } = await query;

  if (!data || data.length === 0) return [];

  return data.map(row => ({
    size_added: parseFloat(row.size_change) || 0,
    price_at_add: parseFloat(row.price_at_event) || 0,
    new_entry_price: parseFloat(row.new_entry_price) || 0,
    new_size: parseFloat(row.new_size) || 0,
    value_usd: parseFloat(row.new_value_usd) || 0,
    detected_at: row.detected_at,
  }));
}

async function getAllTradersInPosition(coin: string, direction: string): Promise<TraderForSignal[]> {
  const { data: positions } = await db.client
    .from('trader_positions')
    .select('*')
    .eq('coin', coin)
    .eq('direction', direction);

  if (!positions || positions.length === 0) return [];

  const traders: TraderForSignal[] = [];

  for (const pos of positions) {
    const quality = await getTraderQuality(pos.address);
    // Skip weak traders entirely
    if (!quality || quality.quality_tier === 'weak') continue;

    const convictionPct = quality.account_value > 0
      ? Math.min(100, (pos.value_usd / quality.account_value) * 100)
      : 0;

    const unrealizedPnlPct = pos.value_usd > 0
      ? (pos.unrealized_pnl / pos.value_usd) * 100
      : 0;

    const additions = await getPositionAdditions(pos.address, coin, direction, pos.opened_at);

    traders.push({
      address: pos.address,
      tier: quality.quality_tier as 'elite' | 'good',
      pnl_7d: quality.pnl_7d || 0,
      pnl_30d: quality.pnl_30d || 0,
      win_rate: quality.win_rate || 0,
      profit_factor: quality.profit_factor || 1,
      entry_price: pos.entry_price,
      position_value: pos.value_usd,
      leverage: pos.leverage || 1,
      liquidation_price: pos.liquidation_price,
      conviction_pct: convictionPct,
      has_stop_order: pos.has_stop_order || false,
      opened_at: pos.opened_at,
      unrealized_pnl: pos.unrealized_pnl || 0,
      unrealized_pnl_pct: unrealizedPnlPct,
      additions,
      // V12: Initialize exit fields as null (trader still in position)
      exit_price: null,
      exited_at: null,
      exit_type: null,
    });
  }

  return traders;
}

async function calculateEnhancedStopLoss(
  coin: string,
  direction: 'long' | 'short',
  traders: TraderForSignal[],
  entryPrice: number
): Promise<{
  stopLoss: number;
  stopDistancePct: number;
  volatilityRank: number;
  atrMultiple: number;
}> {
  const { data: volData } = await db.client
    .from('coin_volatility')
    .select('*')
    .eq('coin', coin)
    .single();

  let atrPct = 5;
  let volatilityRank = 50;
  
  if (volData && volData.atr_14d && volData.last_price) {
    atrPct = (parseFloat(volData.atr_14d) / parseFloat(volData.last_price)) * 100;
    volatilityRank = volData.volatility_rank || 50;
  }

  const stopConfig = calculateDynamicStopDistance(atrPct, volatilityRank);
  
  let stopDistancePct = atrPct * stopConfig.multiplier;
  stopDistancePct = Math.max(stopConfig.minStop, Math.min(stopConfig.maxStop, stopDistancePct));

  const liqPrices = traders
    .map(t => t.liquidation_price)
    .filter((p): p is number => p !== null && p > 0);

  let stopLoss: number;
  
  if (direction === 'long') {
    stopLoss = entryPrice * (1 - stopDistancePct / 100);
    if (liqPrices.length > 0) {
      const liqBasedStop = Math.max(...liqPrices) * 1.15;
      stopLoss = Math.max(stopLoss, liqBasedStop);
    }
    stopLoss = Math.min(stopLoss, entryPrice * (1 - stopConfig.minStop / 100));
  } else {
    stopLoss = entryPrice * (1 + stopDistancePct / 100);
    if (liqPrices.length > 0) {
      const liqBasedStop = Math.min(...liqPrices) * 0.85;
      stopLoss = Math.min(stopLoss, liqBasedStop);
    }
    stopLoss = Math.max(stopLoss, entryPrice * (1 + stopConfig.minStop / 100));
  }

  const finalStopDistancePct = Math.abs(stopLoss - entryPrice) / entryPrice * 100;

  return {
    stopLoss,
    stopDistancePct: finalStopDistancePct,
    volatilityRank,
    atrMultiple: stopConfig.multiplier,
  };
}

function calculateTakeProfits(
  direction: 'long' | 'short',
  entry: number,
  stopLoss: number
): { tp1: number; tp2: number; tp3: number } {
  const riskDistance = Math.abs(entry - stopLoss);
  
  if (direction === 'long') {
    return {
      tp1: entry + riskDistance * 1,
      tp2: entry + riskDistance * 2,
      tp3: entry + riskDistance * 3,
    };
  } else {
    return {
      tp1: entry - riskDistance * 1,
      tp2: entry - riskDistance * 2,
      tp3: entry - riskDistance * 3,
    };
  }
}

function calculateConfidence(
  eliteCount: number,
  goodCount: number,
  avgWinRate: number,
  avgProfitFactor: number,
  combinedPnl7d: number,
  avgConvictionPct: number,
  fundingContext: string,
  signalTier: SignalTier
): number {
  let confidence = 0;

  // V11: Tier-based base scoring
  if (signalTier === 'consensus') {
    confidence += 30;
  } else if (signalTier === 'confirmed') {
    confidence += 20;
  } else {
    // elite_entry - lower base confidence
    confidence += 10;
  }

  // Additional trader count scoring
  if (eliteCount >= 3) confidence += 10;
  else if (eliteCount >= 2) confidence += 5;

  // Win rate scoring
  if (avgWinRate >= 0.6) confidence += 20;
  else if (avgWinRate >= 0.55) confidence += 15;
  else if (avgWinRate >= 0.5) confidence += 10;
  else confidence += 5;

  // Profit factor scoring
  if (avgProfitFactor >= 2.0) confidence += 15;
  else if (avgProfitFactor >= 1.5) confidence += 10;
  else if (avgProfitFactor >= 1.2) confidence += 5;

  // Combined P&L scoring
  if (combinedPnl7d >= 100000) confidence += 15;
  else if (combinedPnl7d >= 50000) confidence += 10;
  else if (combinedPnl7d >= 25000) confidence += 7;
  else if (combinedPnl7d >= 10000) confidence += 5;

  // Conviction scoring
  if (avgConvictionPct >= 30) confidence += 10;
  else if (avgConvictionPct >= 20) confidence += 7;
  else if (avgConvictionPct >= 10) confidence += 5;

  // Funding context
  if (fundingContext === 'favorable') confidence += 5;

  return Math.max(0, Math.min(100, confidence));
}

function calculateRiskScore(
  avgProfitFactor: number,
  avgWinRate: number,
  stopDistancePct: number,
  eliteCount: number,
  volatilityRank: number,
  fundingContext: string,
  signalTier: SignalTier
): number {
  let risk = 50;

  // V11: Higher risk for single trader signals
  if (signalTier === 'elite_entry') {
    risk += 15;
  } else if (signalTier === 'confirmed') {
    risk += 5;
  }

  risk -= eliteCount * 5;

  if (avgProfitFactor >= 2.0) risk -= 10;
  else if (avgProfitFactor >= 1.5) risk -= 5;

  if (avgWinRate >= 0.6) risk -= 10;
  else if (avgWinRate >= 0.55) risk -= 5;

  if (stopDistancePct > 15) risk += 15;
  else if (stopDistancePct > 10) risk += 10;
  else if (stopDistancePct > 5) risk += 5;

  if (volatilityRank >= 80) risk += 15;
  else if (volatilityRank >= 60) risk += 10;
  else if (volatilityRank >= 40) risk += 5;

  if (fundingContext === 'unfavorable') risk += 10;

  return Math.max(0, Math.min(100, risk));
}

function calculateSuggestedLeverage(
  avgLeverage: number,
  stopDistancePct: number
): number {
  const maxRiskPct = 0.02;
  const safeLeverage = (maxRiskPct * 100) / stopDistancePct;
  
  return Math.min(
    Math.round(Math.min(avgLeverage * 0.8, safeLeverage)),
    config.signals.maxSuggestedLeverage
  );
}

// Keep for backwards compatibility with signal_strength field
function determineSignalStrength(eliteCount: number, goodCount: number): 'strong' | 'medium' {
  const { strongSignal } = config.signals;

  if (eliteCount >= strongSignal.minElite) return 'strong';
  if (goodCount >= strongSignal.minGood) return 'strong';
  if (eliteCount >= strongSignal.minMixed.elite && 
      goodCount >= strongSignal.minMixed.good) return 'strong';

  return 'medium';
}

// ============================================
// V12: Update Trader Exit Data in Signal
// ============================================

async function updateTraderExitInSignal(
  signal: ActiveSignal,
  traderAddress: string,
  exitPrice: number,
  exitType: ExitType
): Promise<TraderForSignal[]> {
  const traders = signal.traders || [];
  const exitedAt = new Date().toISOString();
  
  const updatedTraders = traders.map(trader => {
    if (trader.address.toLowerCase() === traderAddress.toLowerCase()) {
      return {
        ...trader,
        exit_price: exitPrice,
        exited_at: exitedAt,
        exit_type: exitType,
      };
    }
    return trader;
  });

  return updatedTraders;
}

// ============================================
// V11: Update Signal Trader Tiers
// ============================================

export async function updateSignalTraderTiers(): Promise<void> {
  try {
    const { data: activeSignals } = await db.client
      .from('quality_signals')
      .select('id, coin, direction, traders, signal_tier')
      .eq('is_active', true);

    if (!activeSignals || activeSignals.length === 0) return;

    for (const signal of activeSignals) {
      const traders = signal.traders as TraderForSignal[];
      if (!traders || traders.length === 0) continue;

      let updated = false;
      let removedCount = 0;
      const updatedTraders: TraderForSignal[] = [];

      for (const trader of traders) {
        const currentQuality = await getTraderQuality(trader.address);
        
        if (!currentQuality || currentQuality.quality_tier === 'weak') {
          logger.info(
            `Removing ${trader.address.slice(0, 8)}... from ${signal.coin} signal - ` +
            `was ${trader.tier}, now ${currentQuality?.quality_tier || 'untracked'}`
          );
          removedCount++;
          updated = true;
          continue;
        }

        if (currentQuality.quality_tier !== trader.tier) {
          logger.info(
            `Updating ${trader.address.slice(0, 8)}... in ${signal.coin} signal - ` +
            `${trader.tier} → ${currentQuality.quality_tier}`
          );
          trader.tier = currentQuality.quality_tier as 'elite' | 'good';
          trader.pnl_7d = currentQuality.pnl_7d || 0;
          trader.pnl_30d = currentQuality.pnl_30d || 0;
          trader.win_rate = currentQuality.win_rate || 0;
          trader.profit_factor = currentQuality.profit_factor || 1;
          updated = true;
        }

        updatedTraders.push(trader);
      }

      if (updated) {
        const eliteCount = updatedTraders.filter(t => t.tier === 'elite').length;
        const goodCount = updatedTraders.filter(t => t.tier === 'good').length;

        // V11: Check if signal still meets minimum requirements
        const stillQualifies = shouldCreateSignal(eliteCount, goodCount);

        if (!stillQualifies || updatedTraders.length === 0) {
          await closeSignal(signal as unknown as ActiveSignal, 'traders_no_longer_qualify');
        } else {
          const newTier = determineSignalTier(eliteCount, goodCount);
          const combinedPnl7d = updatedTraders.reduce((sum, t) => sum + t.pnl_7d, 0);
          const avgWinRate = updatedTraders.reduce((sum, t) => sum + t.win_rate, 0) / updatedTraders.length;
          const avgProfitFactor = updatedTraders.reduce((sum, t) => sum + t.profit_factor, 0) / updatedTraders.length;
          const avgConvictionPct = updatedTraders.reduce((sum, t) => sum + t.conviction_pct, 0) / updatedTraders.length;

          const fundingData = await getSignalFundingContext(signal.coin, signal.direction as 'long' | 'short');

          const confidence = calculateConfidence(
            eliteCount,
            goodCount,
            avgWinRate,
            avgProfitFactor,
            combinedPnl7d,
            avgConvictionPct,
            fundingData.context,
            newTier
          );

          await db.client
            .from('quality_signals')
            .update({
              traders: updatedTraders,
              elite_count: eliteCount,
              good_count: goodCount,
              total_traders: updatedTraders.length,
              combined_pnl_7d: combinedPnl7d,
              avg_win_rate: avgWinRate,
              avg_profit_factor: avgProfitFactor,
              confidence,
              signal_tier: newTier,
              signal_strength: determineSignalStrength(eliteCount, goodCount),
              updated_at: new Date().toISOString(),
            })
            .eq('id', signal.id);

          logger.info(
            `Updated ${signal.coin} ${signal.direction} signal: ` +
            `removed ${removedCount} traders, now ${eliteCount}E + ${goodCount}G (${newTier})`
          );
        }
      }
    }
  } catch (error) {
    logger.error('Failed to update signal trader tiers', error);
  }
}

// ============================================
// EVENT HANDLERS
// ============================================

async function handleOpenEvent(change: PositionChange): Promise<void> {
  const { address, coin, direction, detected_at } = change;
  
  const trader = await getTraderQuality(address);
  if (!trader || trader.quality_tier === 'weak') {
    logger.debug(`Open event for ${coin} by ${address.slice(0, 8)}... - not a tracked quality trader`);
    return;
  }

  logger.info(`🎯 OPEN EVENT: ${trader.quality_tier.toUpperCase()} trader ${address.slice(0, 8)}... opened ${direction} ${coin}`);

  const existingSignal = await getActiveSignalForCoin(coin, direction);
  
  if (existingSignal) {
    await handleTraderJoinsSignal(existingSignal, change, trader);
  } else {
    await evaluateNewSignal(change, trader);
  }
}

async function handleTraderJoinsSignal(
  signal: ActiveSignal,
  change: PositionChange,
  trader: TraderQuality
): Promise<void> {
  const allTraders = await getAllTradersInPosition(signal.coin, signal.direction);
  
  const eliteCount = allTraders.filter(t => t.tier === 'elite').length;
  const goodCount = allTraders.filter(t => t.tier === 'good').length;
  
  const combinedPnl7d = allTraders.reduce((sum, t) => sum + t.pnl_7d, 0);
  const avgWinRate = allTraders.reduce((sum, t) => sum + t.win_rate, 0) / allTraders.length;
  const avgProfitFactor = allTraders.reduce((sum, t) => sum + t.profit_factor, 0) / allTraders.length;
  const avgConvictionPct = allTraders.reduce((sum, t) => sum + t.conviction_pct, 0) / allTraders.length;
  const totalPositionValue = allTraders.reduce((sum, t) => sum + t.position_value, 0);

  const fundingData = await getSignalFundingContext(signal.coin, signal.direction as 'long' | 'short');

  // V11: Determine new tier (might upgrade)
  const newTier = determineSignalTier(eliteCount, goodCount);
  const oldTier = signal.signal_tier || 'elite_entry';

  const confidence = calculateConfidence(
    eliteCount,
    goodCount,
    avgWinRate,
    avgProfitFactor,
    combinedPnl7d,
    avgConvictionPct,
    fundingData.context,
    newTier
  );

  await db.client
    .from('quality_signals')
    .update({
      elite_count: eliteCount,
      good_count: goodCount,
      total_traders: allTraders.length,
      traders: allTraders,
      confidence,
      combined_pnl_7d: combinedPnl7d,
      avg_win_rate: avgWinRate,
      avg_profit_factor: avgProfitFactor,
      avg_conviction_pct: avgConvictionPct,
      total_position_value: totalPositionValue,
      signal_tier: newTier,
      signal_strength: determineSignalStrength(eliteCount, goodCount),
      updated_at: new Date().toISOString(),
    })
    .eq('id', signal.id);

  const tierUpgrade = newTier !== oldTier ? ` | UPGRADED: ${oldTier} → ${newTier}` : '';

  logger.info(
    `📈 Signal updated: ${signal.coin} ${signal.direction} | ` +
    `+1 ${trader.quality_tier} trader | Now ${eliteCount}E + ${goodCount}G | ` +
    `Confidence: ${signal.confidence}% → ${confidence}%${tierUpgrade}`
  );
}

async function evaluateNewSignal(change: PositionChange, triggerTrader: TraderQuality): Promise<void> {
  const { coin, direction, detected_at } = change;
  
  const allTraders = await getAllTradersInPosition(coin, direction);
  
  if (allTraders.length === 0) {
    logger.debug(`No quality traders found for ${coin} ${direction}`);
    return;
  }

  const eliteTraders = allTraders.filter(t => t.tier === 'elite');
  const goodTraders = allTraders.filter(t => t.tier === 'good');
  const eliteCount = eliteTraders.length;
  const goodCount = goodTraders.length;

  // V11: New signal requirements - single elite is enough
  if (!shouldCreateSignal(eliteCount, goodCount)) {
    logger.debug(
      `${coin} ${direction}: Doesn't meet requirements - ${eliteCount}E + ${goodCount}G | ` +
      `Need: 1+ elite OR 3+ good`
    );
    return;
  }

  // V11: Determine signal tier
  const signalTier = determineSignalTier(eliteCount, goodCount);

  // Calculate signal metrics
  const combinedPnl7d = allTraders.reduce((sum, t) => sum + t.pnl_7d, 0);
  const combinedPnl30d = allTraders.reduce((sum, t) => sum + t.pnl_30d, 0);
  const avgWinRate = allTraders.reduce((sum, t) => sum + t.win_rate, 0) / allTraders.length;
  const avgProfitFactor = allTraders.reduce((sum, t) => sum + t.profit_factor, 0) / allTraders.length;
  const avgLeverage = allTraders.reduce((sum, t) => sum + t.leverage, 0) / allTraders.length;
  const avgConvictionPct = allTraders.reduce((sum, t) => sum + t.conviction_pct, 0) / allTraders.length;
  const totalPositionValue = allTraders.reduce((sum, t) => sum + t.position_value, 0);
  const tradersWithStops = allTraders.filter(t => t.has_stop_order).length;

  // V11: Relaxed quality checks for elite_entry signals
  if (signalTier !== 'elite_entry') {
    // Only apply stricter checks for confirmed/consensus
    if (combinedPnl7d < config.signals.minCombinedPnl7d) {
      logger.debug(`${coin} ${direction}: Combined 7d PnL too low ($${combinedPnl7d.toFixed(0)})`);
      return;
    }

    if (avgWinRate < config.signals.minAvgWinRate) {
      logger.debug(`${coin} ${direction}: Avg win rate too low (${(avgWinRate * 100).toFixed(1)}%)`);
      return;
    }
  }

  // Get current price for entry
  const currentPrice = await hyperliquid.getMidPrice(coin);
  if (!currentPrice) {
    logger.error(`Could not get price for ${coin}`);
    return;
  }

  // Calculate stop loss and take profits
  const stopData = await calculateEnhancedStopLoss(coin, direction, allTraders, currentPrice);
  const tps = calculateTakeProfits(direction, currentPrice, stopData.stopLoss);

  // Get funding context
  const fundingData = await getSignalFundingContext(coin, direction);

  // Calculate confidence and risk
  const confidence = calculateConfidence(
    eliteCount,
    goodCount,
    avgWinRate,
    avgProfitFactor,
    combinedPnl7d,
    avgConvictionPct,
    fundingData.context,
    signalTier
  );

  const riskScore = calculateRiskScore(
    avgProfitFactor,
    avgWinRate,
    stopData.stopDistancePct,
    eliteCount,
    stopData.volatilityRank,
    fundingData.context,
    signalTier
  );

  const suggestedLeverage = calculateSuggestedLeverage(avgLeverage, stopData.stopDistancePct);
  const signalStrength = determineSignalStrength(eliteCount, goodCount);

  // Calculate combined account value
  let combinedAccountValue = 0;
  for (const t of allTraders) {
    const quality = await getTraderQuality(t.address);
    if (quality) combinedAccountValue += quality.account_value;
  }

  // Entry price range from traders
  const entryPrices = allTraders.map(t => t.entry_price).filter(p => p > 0);
  const entryRangeLow = entryPrices.length > 0 ? Math.min(...entryPrices) : currentPrice * 0.99;
  const entryRangeHigh = entryPrices.length > 0 ? Math.max(...entryPrices) : currentPrice * 1.01;

  // Create the signal
  const signalData = {
    coin,
    direction,
    elite_count: eliteCount,
    good_count: goodCount,
    total_traders: allTraders.length,
    combined_pnl_7d: combinedPnl7d,
    combined_pnl_30d: combinedPnl30d,
    combined_account_value: combinedAccountValue,
    avg_win_rate: avgWinRate,
    avg_profit_factor: avgProfitFactor,
    total_position_value: totalPositionValue,
    avg_entry_price: currentPrice,
    avg_leverage: avgLeverage,
    traders: allTraders,
    signal_tier: signalTier,
    signal_strength: signalStrength,
    confidence,
    directional_agreement: 1.0,
    opposing_traders: 0,
    suggested_entry: currentPrice,
    entry_price: currentPrice,
    entry_range_low: entryRangeLow,
    entry_range_high: entryRangeHigh,
    stop_loss: stopData.stopLoss,
    stop_distance_pct: stopData.stopDistancePct,
    take_profit_1: tps.tp1,
    take_profit_2: tps.tp2,
    take_profit_3: tps.tp3,
    suggested_leverage: suggestedLeverage,
    risk_score: riskScore,
    avg_conviction_pct: avgConvictionPct,
    funding_context: fundingData.context,
    current_funding_rate: fundingData.fundingRate,
    volatility_adjusted_stop: stopData.stopLoss,
    atr_multiple: stopData.atrMultiple,
    current_price: currentPrice,
    is_active: true,
    outcome: 'open',
    entry_detected_at: detected_at.toISOString(),
    is_verified_open: true,
    trigger_event_id: change.id || null,
    expires_at: new Date(Date.now() + config.signals.expiryHours * 60 * 60 * 1000).toISOString(),
  };

  const { error } = await db.client
    .from('quality_signals')
    .insert(signalData);

  if (error) {
    logger.error(`Failed to create signal for ${coin}`, error);
    return;
  }

  // V11: Different log message based on tier
  const tierEmoji = signalTier === 'elite_entry' ? '⚡' : signalTier === 'consensus' ? '🚨🚨' : '🚨';
  const tierLabel = signalTier === 'elite_entry' ? 'ELITE ENTRY' : signalTier.toUpperCase();

  logger.info(
    `${tierEmoji} NEW ${tierLabel} SIGNAL: ${coin} ${direction.toUpperCase()} | ` +
    `${eliteCount}E + ${goodCount}G traders | ` +
    `Entry: $${currentPrice.toFixed(4)} | Stop: ${stopData.stopDistancePct.toFixed(1)}% | ` +
    `Confidence: ${confidence}% | ` +
    `Detected: ${detected_at.toISOString()}`
  );
}

async function handleIncreaseEvent(change: PositionChange): Promise<void> {
  const { address, coin, direction } = change;
  
  const trader = await getTraderQuality(address);
  if (!trader || trader.quality_tier === 'weak') return;

  const existingSignal = await getActiveSignalForCoin(coin, direction);
  if (!existingSignal) {
    await evaluateNewSignal(change, trader);
    return;
  }

  const allTraders = await getAllTradersInPosition(coin, direction);
  const avgConvictionPct = allTraders.reduce((sum, t) => sum + t.conviction_pct, 0) / allTraders.length;
  const totalPositionValue = allTraders.reduce((sum, t) => sum + t.position_value, 0);

  await db.client
    .from('quality_signals')
    .update({
      traders: allTraders,
      avg_conviction_pct: avgConvictionPct,
      total_position_value: totalPositionValue,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existingSignal.id);

  logger.info(
    `📈 ${coin} ${direction}: ${address.slice(0, 8)}... added to position | ` +
    `+${change.size_change.toFixed(4)} @ $${change.price_at_event.toFixed(2)}`
  );
}

async function handleDecreaseEvent(change: PositionChange): Promise<void> {
  const { address, coin, direction } = change;
  
  const existingSignal = await getActiveSignalForCoin(coin, direction);
  if (!existingSignal) return;

  const allTraders = await getAllTradersInPosition(coin, direction);
  
  if (allTraders.length === 0) {
    await closeSignal(existingSignal, 'all_traders_exited');
    return;
  }

  const eliteCount = allTraders.filter(t => t.tier === 'elite').length;
  const goodCount = allTraders.filter(t => t.tier === 'good').length;
  const avgConvictionPct = allTraders.reduce((sum, t) => sum + t.conviction_pct, 0) / allTraders.length;
  const totalPositionValue = allTraders.reduce((sum, t) => sum + t.position_value, 0);

  // V11: Update tier on decrease
  const newTier = determineSignalTier(eliteCount, goodCount);

  await db.client
    .from('quality_signals')
    .update({
      elite_count: eliteCount,
      good_count: goodCount,
      total_traders: allTraders.length,
      traders: allTraders,
      avg_conviction_pct: avgConvictionPct,
      total_position_value: totalPositionValue,
      signal_tier: newTier,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existingSignal.id);

  logger.debug(`Signal ${coin} ${direction} updated - trader decreased position`);
}

async function handleCloseEvent(change: PositionChange): Promise<void> {
  const { address, coin, direction, price_at_event } = change;
  
  const existingSignal = await getActiveSignalForCoin(coin, direction);
  if (!existingSignal) return;

  // V12: Capture this trader's exit data BEFORE removing them from active traders list
  const exitPrice = price_at_event || await hyperliquid.getMidPrice(coin) || 0;
  const updatedTradersWithExit = await updateTraderExitInSignal(
    existingSignal,
    address,
    exitPrice,
    'manual'
  );

  // Get remaining active traders (excludes the one who just closed)
  const allTraders = await getAllTradersInPosition(coin, direction);
  
  if (allTraders.length === 0) {
    // V12: Pass traders with exit data to closeSignal
    await closeSignal(existingSignal, 'all_traders_exited', updatedTradersWithExit);
    return;
  }

  const eliteCount = allTraders.filter(t => t.tier === 'elite').length;
  const goodCount = allTraders.filter(t => t.tier === 'good').length;
  
  // V11: Check if still qualifies
  const stillQualifies = shouldCreateSignal(eliteCount, goodCount);

  if (!stillQualifies) {
    // V12: Pass traders with exit data
    await closeSignal(existingSignal, 'below_minimum_traders', updatedTradersWithExit);
    return;
  }

  // Merge: keep traders who exited (with exit data) + active traders (without exit data)
  const exitedTraders = updatedTradersWithExit.filter(t => t.exit_price !== null);
  const mergedTraders = [...exitedTraders, ...allTraders];

  const combinedPnl7d = allTraders.reduce((sum, t) => sum + t.pnl_7d, 0);
  const avgWinRate = allTraders.reduce((sum, t) => sum + t.win_rate, 0) / allTraders.length;
  const avgProfitFactor = allTraders.reduce((sum, t) => sum + t.profit_factor, 0) / allTraders.length;
  const avgConvictionPct = allTraders.reduce((sum, t) => sum + t.conviction_pct, 0) / allTraders.length;
  const totalPositionValue = allTraders.reduce((sum, t) => sum + t.position_value, 0);

  const fundingData = await getSignalFundingContext(coin, direction as 'long' | 'short');
  const newTier = determineSignalTier(eliteCount, goodCount);

  const confidence = calculateConfidence(
    eliteCount,
    goodCount,
    avgWinRate,
    avgProfitFactor,
    combinedPnl7d,
    avgConvictionPct,
    fundingData.context,
    newTier
  );

  await db.client
    .from('quality_signals')
    .update({
      elite_count: eliteCount,
      good_count: goodCount,
      total_traders: allTraders.length,
      traders: mergedTraders,  // V12: Store both exited and active traders
      confidence,
      combined_pnl_7d: combinedPnl7d,
      avg_win_rate: avgWinRate,
      avg_profit_factor: avgProfitFactor,
      avg_conviction_pct: avgConvictionPct,
      total_position_value: totalPositionValue,
      signal_tier: newTier,
      signal_strength: determineSignalStrength(eliteCount, goodCount),
      updated_at: new Date().toISOString(),
    })
    .eq('id', existingSignal.id);

  logger.info(
    `📉 Signal updated: ${coin} ${direction} | ` +
    `Trader ${address.slice(0, 8)}... exited @ $${exitPrice.toFixed(2)} | ` +
    `Now ${eliteCount}E + ${goodCount}G (${newTier}) | ` +
    `Confidence: ${existingSignal.confidence}% → ${confidence}%`
  );
}

async function handleFlipEvent(change: PositionChange): Promise<void> {
  const oldDirection = change.direction === 'long' ? 'short' : 'long';
  
  const oldSignal = await getActiveSignalForCoin(change.coin, oldDirection);
  if (oldSignal) {
    await closeSignal(oldSignal, 'trader_flipped_direction');
  }

  await handleOpenEvent(change);
}

// V12: Updated closeSignal to accept pre-computed traders with exit data
async function closeSignal(
  signal: ActiveSignal, 
  reason: string,
  tradersWithExitData?: TraderForSignal[]
): Promise<void> {
  const currentPrice = await hyperliquid.getMidPrice(signal.coin);
  const closedAt = new Date().toISOString();
  
  let pnlPct = 0;
  if (currentPrice && signal.entry_price) {
    if (signal.direction === 'long') {
      pnlPct = ((currentPrice - signal.entry_price) / signal.entry_price) * 100;
    } else {
      pnlPct = ((signal.entry_price - currentPrice) / signal.entry_price) * 100;
    }
  }

  // V12: Populate exit data for any traders who don't have it yet
  let finalTraders = tradersWithExitData || signal.traders || [];
  
  finalTraders = finalTraders.map(trader => {
    if (trader.exit_price === null || trader.exit_price === undefined) {
      return {
        ...trader,
        exit_price: currentPrice || signal.entry_price,
        exited_at: closedAt,
        exit_type: 'signal_closed' as ExitType,
      };
    }
    return trader;
  });

  await db.client
    .from('quality_signals')
    .update({
      is_active: false,
      invalidated: true,
      invalidation_reason: reason,
      outcome: pnlPct > 0 ? 'profit' : 'loss',
      final_pnl_pct: pnlPct,
      current_price: currentPrice,
      closed_at: closedAt,
      traders: finalTraders,  // V12: Save traders with exit data
    })
    .eq('id', signal.id);

  logger.info(
    `🔴 Signal closed: ${signal.coin} ${signal.direction} | ` +
    `Reason: ${reason} | P&L: ${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(2)}%`
  );
}

// ============================================
// MAIN: Process Position Changes
// ============================================

export async function processPositionChanges(changes: PositionChange[]): Promise<void> {
  for (const change of changes) {
    try {
      switch (change.event_type) {
        case 'open':
          await handleOpenEvent(change);
          break;
        case 'increase':
          await handleIncreaseEvent(change);
          break;
        case 'decrease':
          await handleDecreaseEvent(change);
          break;
        case 'close':
          await handleCloseEvent(change);
          break;
        case 'flip':
          await handleFlipEvent(change);
          break;
      }
    } catch (error) {
      logger.error(`Error processing ${change.event_type} event for ${change.coin}`, error);
    }
  }
}

// ============================================
// Price Monitoring (for stop/TP hits)
// ============================================

async function checkPriceTargets(): Promise<void> {
  const { data: activeSignals } = await db.client
    .from('quality_signals')
    .select('*')
    .eq('is_active', true);

  if (!activeSignals || activeSignals.length === 0) return;

  for (const signal of activeSignals) {
    const currentPrice = await hyperliquid.getMidPrice(signal.coin);
    if (!currentPrice) continue;

    const direction = signal.direction as 'long' | 'short';
    let hitStop = false;
    let hitTp1 = signal.hit_tp1 || false;
    let hitTp2 = signal.hit_tp2 || false;
    let hitTp3 = signal.hit_tp3 || false;

    if (direction === 'long') {
      if (currentPrice <= signal.stop_loss) hitStop = true;
      if (currentPrice >= signal.take_profit_1) hitTp1 = true;
      if (currentPrice >= signal.take_profit_2) hitTp2 = true;
      if (currentPrice >= signal.take_profit_3) hitTp3 = true;
    } else {
      if (currentPrice >= signal.stop_loss) hitStop = true;
      if (currentPrice <= signal.take_profit_1) hitTp1 = true;
      if (currentPrice <= signal.take_profit_2) hitTp2 = true;
      if (currentPrice <= signal.take_profit_3) hitTp3 = true;
    }

    let currentPnlPct = 0;
    if (signal.entry_price) {
      if (direction === 'long') {
        currentPnlPct = ((currentPrice - signal.entry_price) / signal.entry_price) * 100;
      } else {
        currentPnlPct = ((signal.entry_price - currentPrice) / signal.entry_price) * 100;
      }
    }

    const peakPrice = signal.peak_price 
      ? (direction === 'long' ? Math.max(signal.peak_price, currentPrice) : Math.min(signal.peak_price, currentPrice))
      : currentPrice;
    const troughPrice = signal.trough_price
      ? (direction === 'long' ? Math.min(signal.trough_price, currentPrice) : Math.max(signal.trough_price, currentPrice))
      : currentPrice;

    if (hitStop) {
      // V12: Update traders with stop exit data
      const closedAt = new Date().toISOString();
      const tradersWithExit = (signal.traders || []).map((trader: TraderForSignal) => ({
        ...trader,
        exit_price: trader.exit_price ?? currentPrice,
        exited_at: trader.exited_at ?? closedAt,
        exit_type: trader.exit_type ?? 'stopped' as ExitType,
      }));

      await db.client
        .from('quality_signals')
        .update({
          is_active: false,
          outcome: 'stopped_out',
          hit_stop: true,
          final_pnl_pct: currentPnlPct,
          current_price: currentPrice,
          closed_at: closedAt,
          traders: tradersWithExit,
        })
        .eq('id', signal.id);

      logger.info(`🛑 STOP HIT: ${signal.coin} ${signal.direction} | P&L: ${currentPnlPct.toFixed(2)}%`);
    } else if (hitTp3 && !signal.hit_tp3) {
      // V12: Update traders with TP3 exit data
      const closedAt = new Date().toISOString();
      const tradersWithExit = (signal.traders || []).map((trader: TraderForSignal) => ({
        ...trader,
        exit_price: trader.exit_price ?? currentPrice,
        exited_at: trader.exited_at ?? closedAt,
        exit_type: trader.exit_type ?? 'manual' as ExitType,
      }));

      await db.client
        .from('quality_signals')
        .update({
          is_active: false,
          outcome: 'tp3_hit',
          hit_tp1: true,
          hit_tp2: true,
          hit_tp3: true,
          final_pnl_pct: currentPnlPct,
          current_price: currentPrice,
          closed_at: closedAt,
          traders: tradersWithExit,
        })
        .eq('id', signal.id);

      logger.info(`🎯🎯🎯 TP3 HIT: ${signal.coin} ${signal.direction} | P&L: +${currentPnlPct.toFixed(2)}%`);
    } else {
      await db.client
        .from('quality_signals')
        .update({
          current_price: currentPrice,
          current_pnl_pct: currentPnlPct,
          peak_price: peakPrice,
          trough_price: troughPrice,
          max_pnl_pct: Math.max(signal.max_pnl_pct || 0, currentPnlPct),
          min_pnl_pct: Math.min(signal.min_pnl_pct || 0, currentPnlPct),
          hit_tp1: hitTp1,
          hit_tp2: hitTp2,
          updated_at: new Date().toISOString(),
        })
        .eq('id', signal.id);
    }
  }
}

// ============================================
// Initialization
// ============================================

let priceCheckInterval: NodeJS.Timeout | null = null;
let tierUpdateInterval: NodeJS.Timeout | null = null;

export function initializeSignalGenerator(): void {
  logger.info('Signal Generator V12 initializing (with per-trader exit tracking)...');
  
  subscribeToPositionChanges(processPositionChanges);
  
  priceCheckInterval = setInterval(checkPriceTargets, 60 * 1000);
  tierUpdateInterval = setInterval(updateSignalTraderTiers, 5 * 60 * 1000);
  
  logger.info('Signal Generator V12 ready - tracks per-trader entry AND exit data');
}

export function stopSignalGenerator(): void {
  if (priceCheckInterval) {
    clearInterval(priceCheckInterval);
    priceCheckInterval = null;
  }
  if (tierUpdateInterval) {
    clearInterval(tierUpdateInterval);
    tierUpdateInterval = null;
  }
  logger.info('Signal Generator V12 stopped');
}

// ============================================
// Exports
// ============================================

export async function getActiveSignals(): Promise<unknown[]> {
  const { data } = await db.client
    .from('quality_signals')
    .select('*')
    .eq('is_active', true)
    .order('confidence', { ascending: false });

  return data || [];
}

export async function getSignalForCoin(coin: string): Promise<unknown | null> {
  const { data } = await db.client
    .from('quality_signals')
    .select('*')
    .eq('coin', coin)
    .eq('is_active', true)
    .single();

  return data;
}

export async function getVerifiedSignals(): Promise<unknown[]> {
  const { data } = await db.client
    .from('quality_signals')
    .select('*')
    .eq('is_active', true)
    .eq('is_verified_open', true)
    .order('entry_detected_at', { ascending: false });

  return data || [];
}

export async function generateSignals(): Promise<void> {
  logger.debug('generateSignals() called - V12 is event-driven, no action needed');
}

export default {
  initializeSignalGenerator,
  stopSignalGenerator,
  processPositionChanges,
  updateSignalTraderTiers,
  getActiveSignals,
  getSignalForCoin,
  getVerifiedSignals,
  generateSignals,
};