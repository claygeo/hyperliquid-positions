// Signal Generator V12.2
// 
// V12.2 CHANGES (Data-Driven Exit Strategy):
// - Fixed take profit at +2% (data shows +23.26% total vs +14.28% with current)
// - Time-based exit at 20 hours (24h+ trades show -1.60% avg)
// - Trailing stop: activates at +0.5%, trails 0.5% behind peak
// - Coin blacklist: GRASS, ZEC, SOL, ETH (negative historical expectancy)
//
// V12.1 CHANGES:
// - Fresh position filtering - only include traders who opened within MAX_POSITION_AGE_HOURS
// - Prevents signals from being created for stale positions opened days/weeks ago
//
// V12 CHANGES:
// - Tracks per-trader exit data (exit_price, exited_at, exit_type)
// - When a trader closes their position, we capture their exit price/time
// - When signal closes, any remaining traders get exit data populated
//
// ARCHITECTURE:
// - EVENT-DRIVEN: Only creates signals when we WITNESS a position open
// - VERIFIED: Every signal has entry_detected_at = when WE saw the open
// - EXIT TRACKING: Each trader has exit_price, exited_at, exit_type
// - FRESH ONLY: Filters out positions older than MAX_POSITION_AGE_HOURS
// - SMART EXIT: Fixed TP, trailing stop, time-based exit

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import hyperliquid from '../utils/hyperliquid-api.js';
import { PositionChange, subscribeToPositionChanges } from './position-tracker.js';
import { getSignalFundingContext } from './funding-tracker.js';

const logger = createLogger('signal-generator-v12');

// ============================================
// Configuration
// ============================================

// V12.2: Maximum age of a position to be included in signals (in hours)
// Positions older than this are considered "stale" and won't trigger/join signals
const MAX_POSITION_AGE_HOURS = 24;

// V12.2: Exit Strategy Configuration (data-driven)
// Based on analysis: 12-24h holds = +2.66% avg, 24h+ = -1.60% avg
const MAX_SIGNAL_AGE_HOURS = 20;  // Close signals after 20 hours (before they turn negative)

// Fixed take profit - data shows +2% TP = +23.26% vs +14.28% current
const FIXED_TP_PCT = 2.0;

// Trailing stop configuration
// 75% of signals reach +0.5%, so activate trailing stop there
const TRAILING_STOP_ACTIVATE_PCT = 0.5;
const TRAILING_STOP_DISTANCE_PCT = 0.5;  // Trail 0.5% behind peak

// Coin blacklist - these coins have negative expectancy
// GRASS: -6.97%, ZEC: -6.44%, SOL: -0.59%, ETH: -2.63%
const COIN_BLACKLIST = ['GRASS', 'ZEC', 'SOL', 'ETH'];

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
  if (eliteCount >= 3 || (eliteCount >= 2 && goodCount >= 2)) {
    return 'consensus';
  }
  if (eliteCount >= 2 || (eliteCount >= 1 && goodCount >= 1) || goodCount >= 3) {
    return 'confirmed';
  }
  if (eliteCount >= 1) {
    return 'elite_entry';
  }
  return 'elite_entry';
}

function shouldCreateSignal(eliteCount: number, goodCount: number): boolean {
  if (eliteCount >= 1) return true;
  if (goodCount >= 3) return true;
  return false;
}

// ============================================
// V12.2: Position Age Filtering
// ============================================

/**
 * Check if a position is fresh enough to be included in signals
 */
function isPositionFresh(openedAt: string | null | undefined): boolean {
  if (!openedAt) return true; // No timestamp = assume fresh
  
  const openedTime = new Date(openedAt).getTime();
  const hoursAgo = (Date.now() - openedTime) / (1000 * 60 * 60);
  
  return hoursAgo < MAX_POSITION_AGE_HOURS;
}

function getPositionAgeHours(openedAt: string | null | undefined): number {
  if (!openedAt) return 0;
  return (Date.now() - new Date(openedAt).getTime()) / (1000 * 60 * 60);
}

// ============================================
// Volatility-Based Stop Configuration
// ============================================

function calculateDynamicStopDistance(
  atrPct: number,
  volatilityRank: number
): { minStop: number; maxStop: number; multiplier: number } {
  if (volatilityRank >= 80) return { minStop: 10, maxStop: 25, multiplier: 2.5 };
  if (volatilityRank >= 60) return { minStop: 7, maxStop: 15, multiplier: 2.0 };
  if (volatilityRank >= 40) return { minStop: 5, maxStop: 12, multiplier: 2.0 };
  if (volatilityRank >= 20) return { minStop: 4, maxStop: 10, multiplier: 1.75 };
  return { minStop: 3, maxStop: 8, multiplier: 1.5 };
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

  if (since) query = query.gte('detected_at', since);
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

// V12.2: Updated to filter out stale positions
async function getAllTradersInPosition(
  coin: string, 
  direction: string,
  filterFresh: boolean = true
): Promise<TraderForSignal[]> {
  const { data: positions } = await db.client
    .from('trader_positions')
    .select('*')
    .eq('coin', coin)
    .eq('direction', direction);

  if (!positions || positions.length === 0) return [];

  const traders: TraderForSignal[] = [];
  let staleCount = 0;

  for (const pos of positions) {
    // V12.2: Filter out stale positions
    if (filterFresh && !isPositionFresh(pos.opened_at)) {
      const ageHours = getPositionAgeHours(pos.opened_at);
      logger.debug(
        `Skipping stale position: ${pos.address.slice(0, 8)}... in ${coin} | ` +
        `Opened ${ageHours.toFixed(1)}h ago (max: ${MAX_POSITION_AGE_HOURS}h)`
      );
      staleCount++;
      continue;
    }

    const quality = await getTraderQuality(pos.address);
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
      exit_price: null,
      exited_at: null,
      exit_type: null,
    });
  }

  if (staleCount > 0) {
    logger.debug(`Filtered out ${staleCount} stale positions for ${coin} ${direction}`);
  }

  return traders;
}

async function calculateEnhancedStopLoss(
  coin: string,
  direction: 'long' | 'short',
  traders: TraderForSignal[],
  entryPrice: number
): Promise<{ stopLoss: number; stopDistancePct: number; volatilityRank: number; atrMultiple: number }> {
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
  let stopDistancePct = Math.max(stopConfig.minStop, Math.min(stopConfig.maxStop, atrPct * stopConfig.multiplier));

  const liqPrices = traders.map(t => t.liquidation_price).filter((p): p is number => p !== null && p > 0);
  let stopLoss: number;
  
  if (direction === 'long') {
    stopLoss = entryPrice * (1 - stopDistancePct / 100);
    if (liqPrices.length > 0) stopLoss = Math.max(stopLoss, Math.max(...liqPrices) * 1.15);
    stopLoss = Math.min(stopLoss, entryPrice * (1 - stopConfig.minStop / 100));
  } else {
    stopLoss = entryPrice * (1 + stopDistancePct / 100);
    if (liqPrices.length > 0) stopLoss = Math.min(stopLoss, Math.min(...liqPrices) * 0.85);
    stopLoss = Math.max(stopLoss, entryPrice * (1 + stopConfig.minStop / 100));
  }

  return {
    stopLoss,
    stopDistancePct: Math.abs(stopLoss - entryPrice) / entryPrice * 100,
    volatilityRank,
    atrMultiple: stopConfig.multiplier,
  };
}

function calculateTakeProfits(direction: 'long' | 'short', entry: number, stopLoss: number) {
  const riskDistance = Math.abs(entry - stopLoss);
  if (direction === 'long') {
    return { tp1: entry + riskDistance, tp2: entry + riskDistance * 2, tp3: entry + riskDistance * 3 };
  }
  return { tp1: entry - riskDistance, tp2: entry - riskDistance * 2, tp3: entry - riskDistance * 3 };
}

function calculateConfidence(
  eliteCount: number, goodCount: number, avgWinRate: number, avgProfitFactor: number,
  combinedPnl7d: number, avgConvictionPct: number, fundingContext: string, signalTier: SignalTier
): number {
  let confidence = signalTier === 'consensus' ? 30 : signalTier === 'confirmed' ? 20 : 10;
  if (eliteCount >= 3) confidence += 10;
  else if (eliteCount >= 2) confidence += 5;
  if (avgWinRate >= 0.6) confidence += 20;
  else if (avgWinRate >= 0.55) confidence += 15;
  else if (avgWinRate >= 0.5) confidence += 10;
  else confidence += 5;
  if (avgProfitFactor >= 2.0) confidence += 15;
  else if (avgProfitFactor >= 1.5) confidence += 10;
  else if (avgProfitFactor >= 1.2) confidence += 5;
  if (combinedPnl7d >= 100000) confidence += 15;
  else if (combinedPnl7d >= 50000) confidence += 10;
  else if (combinedPnl7d >= 25000) confidence += 7;
  else if (combinedPnl7d >= 10000) confidence += 5;
  if (avgConvictionPct >= 30) confidence += 10;
  else if (avgConvictionPct >= 20) confidence += 7;
  else if (avgConvictionPct >= 10) confidence += 5;
  if (fundingContext === 'favorable') confidence += 5;
  return Math.max(0, Math.min(100, confidence));
}

function calculateRiskScore(
  avgProfitFactor: number, avgWinRate: number, stopDistancePct: number,
  eliteCount: number, volatilityRank: number, fundingContext: string, signalTier: SignalTier
): number {
  let risk = 50;
  if (signalTier === 'elite_entry') risk += 15;
  else if (signalTier === 'confirmed') risk += 5;
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

function calculateSuggestedLeverage(avgLeverage: number, stopDistancePct: number): number {
  const safeLeverage = (0.02 * 100) / stopDistancePct;
  return Math.min(Math.round(Math.min(avgLeverage * 0.8, safeLeverage)), config.signals.maxSuggestedLeverage);
}

function determineSignalStrength(eliteCount: number, goodCount: number): 'strong' | 'medium' {
  const { strongSignal } = config.signals;
  if (eliteCount >= strongSignal.minElite) return 'strong';
  if (goodCount >= strongSignal.minGood) return 'strong';
  if (eliteCount >= strongSignal.minMixed.elite && goodCount >= strongSignal.minMixed.good) return 'strong';
  return 'medium';
}

async function updateTraderExitInSignal(signal: ActiveSignal, traderAddress: string, exitPrice: number, exitType: ExitType): Promise<TraderForSignal[]> {
  const traders = signal.traders || [];
  const exitedAt = new Date().toISOString();
  return traders.map(trader => {
    if (trader.address.toLowerCase() === traderAddress.toLowerCase()) {
      return { ...trader, exit_price: exitPrice, exited_at: exitedAt, exit_type: exitType };
    }
    return trader;
  });
}

// ============================================
// Update Signal Trader Tiers
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
          logger.info(`Removing ${trader.address.slice(0, 8)}... from ${signal.coin} - was ${trader.tier}, now ${currentQuality?.quality_tier || 'untracked'}`);
          removedCount++;
          updated = true;
          continue;
        }

        if (currentQuality.quality_tier !== trader.tier) {
          logger.info(`Updating ${trader.address.slice(0, 8)}... in ${signal.coin} - ${trader.tier} → ${currentQuality.quality_tier}`);
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

        if (!shouldCreateSignal(eliteCount, goodCount) || updatedTraders.length === 0) {
          await closeSignal(signal as unknown as ActiveSignal, 'traders_no_longer_qualify');
        } else {
          const newTier = determineSignalTier(eliteCount, goodCount);
          const combinedPnl7d = updatedTraders.reduce((sum, t) => sum + t.pnl_7d, 0);
          const avgWinRate = updatedTraders.reduce((sum, t) => sum + t.win_rate, 0) / updatedTraders.length;
          const avgProfitFactor = updatedTraders.reduce((sum, t) => sum + t.profit_factor, 0) / updatedTraders.length;
          const avgConvictionPct = updatedTraders.reduce((sum, t) => sum + t.conviction_pct, 0) / updatedTraders.length;
          const fundingData = await getSignalFundingContext(signal.coin, signal.direction as 'long' | 'short');
          const confidence = calculateConfidence(eliteCount, goodCount, avgWinRate, avgProfitFactor, combinedPnl7d, avgConvictionPct, fundingData.context, newTier);

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

          logger.info(`Updated ${signal.coin} ${signal.direction}: removed ${removedCount}, now ${eliteCount}E + ${goodCount}G (${newTier})`);
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
    logger.debug(`Open event for ${coin} by ${address.slice(0, 8)}... - not tracked`);
    return;
  }

  logger.info(`🎯 OPEN: ${trader.quality_tier.toUpperCase()} ${address.slice(0, 8)}... opened ${direction} ${coin}`);

  const existingSignal = await getActiveSignalForCoin(coin, direction);
  
  if (existingSignal) {
    await handleTraderJoinsSignal(existingSignal, change, trader);
  } else {
    await evaluateNewSignal(change, trader);
  }
}

async function handleTraderJoinsSignal(signal: ActiveSignal, change: PositionChange, trader: TraderQuality): Promise<void> {
  const allTraders = await getAllTradersInPosition(signal.coin, signal.direction, true);
  
  const eliteCount = allTraders.filter(t => t.tier === 'elite').length;
  const goodCount = allTraders.filter(t => t.tier === 'good').length;
  const combinedPnl7d = allTraders.reduce((sum, t) => sum + t.pnl_7d, 0);
  const avgWinRate = allTraders.reduce((sum, t) => sum + t.win_rate, 0) / allTraders.length;
  const avgProfitFactor = allTraders.reduce((sum, t) => sum + t.profit_factor, 0) / allTraders.length;
  const avgConvictionPct = allTraders.reduce((sum, t) => sum + t.conviction_pct, 0) / allTraders.length;
  const totalPositionValue = allTraders.reduce((sum, t) => sum + t.position_value, 0);

  const fundingData = await getSignalFundingContext(signal.coin, signal.direction as 'long' | 'short');
  const newTier = determineSignalTier(eliteCount, goodCount);
  const oldTier = signal.signal_tier || 'elite_entry';
  const confidence = calculateConfidence(eliteCount, goodCount, avgWinRate, avgProfitFactor, combinedPnl7d, avgConvictionPct, fundingData.context, newTier);

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
  logger.info(`📈 Signal updated: ${signal.coin} ${signal.direction} | +1 ${trader.quality_tier} | Now ${eliteCount}E + ${goodCount}G | Confidence: ${signal.confidence}% → ${confidence}%${tierUpgrade}`);
}

async function evaluateNewSignal(change: PositionChange, triggerTrader: TraderQuality): Promise<void> {
  const { coin, direction, detected_at } = change;
  
  // V12.2: Skip blacklisted coins (negative expectancy based on historical data)
  if (COIN_BLACKLIST.includes(coin)) {
    logger.debug(`Skipping ${coin} - blacklisted due to negative historical performance`);
    return;
  }
  
  const allTraders = await getAllTradersInPosition(coin, direction, true);
  
  if (allTraders.length === 0) {
    logger.debug(`No fresh quality traders for ${coin} ${direction} (within ${MAX_POSITION_AGE_HOURS}h)`);
    return;
  }

  const eliteCount = allTraders.filter(t => t.tier === 'elite').length;
  const goodCount = allTraders.filter(t => t.tier === 'good').length;

  if (!shouldCreateSignal(eliteCount, goodCount)) {
    logger.debug(`${coin} ${direction}: ${eliteCount}E + ${goodCount}G - need 1+ elite OR 3+ good`);
    return;
  }

  const signalTier = determineSignalTier(eliteCount, goodCount);
  const combinedPnl7d = allTraders.reduce((sum, t) => sum + t.pnl_7d, 0);
  const combinedPnl30d = allTraders.reduce((sum, t) => sum + t.pnl_30d, 0);
  const avgWinRate = allTraders.reduce((sum, t) => sum + t.win_rate, 0) / allTraders.length;
  const avgProfitFactor = allTraders.reduce((sum, t) => sum + t.profit_factor, 0) / allTraders.length;
  const avgLeverage = allTraders.reduce((sum, t) => sum + t.leverage, 0) / allTraders.length;
  const avgConvictionPct = allTraders.reduce((sum, t) => sum + t.conviction_pct, 0) / allTraders.length;
  const totalPositionValue = allTraders.reduce((sum, t) => sum + t.position_value, 0);

  if (signalTier !== 'elite_entry') {
    if (combinedPnl7d < config.signals.minCombinedPnl7d) {
      logger.debug(`${coin} ${direction}: Combined 7d PnL too low ($${combinedPnl7d.toFixed(0)})`);
      return;
    }
    if (avgWinRate < config.signals.minAvgWinRate) {
      logger.debug(`${coin} ${direction}: Avg win rate too low (${(avgWinRate * 100).toFixed(1)}%)`);
      return;
    }
  }

  const currentPrice = await hyperliquid.getMidPrice(coin);
  if (!currentPrice) {
    logger.error(`Could not get price for ${coin}`);
    return;
  }

  const stopData = await calculateEnhancedStopLoss(coin, direction, allTraders, currentPrice);
  const tps = calculateTakeProfits(direction, currentPrice, stopData.stopLoss);
  const fundingData = await getSignalFundingContext(coin, direction);
  const confidence = calculateConfidence(eliteCount, goodCount, avgWinRate, avgProfitFactor, combinedPnl7d, avgConvictionPct, fundingData.context, signalTier);
  const riskScore = calculateRiskScore(avgProfitFactor, avgWinRate, stopData.stopDistancePct, eliteCount, stopData.volatilityRank, fundingData.context, signalTier);
  const suggestedLeverage = calculateSuggestedLeverage(avgLeverage, stopData.stopDistancePct);

  let combinedAccountValue = 0;
  for (const t of allTraders) {
    const quality = await getTraderQuality(t.address);
    if (quality) combinedAccountValue += quality.account_value;
  }

  const entryPrices = allTraders.map(t => t.entry_price).filter(p => p > 0);
  const entryRangeLow = entryPrices.length > 0 ? Math.min(...entryPrices) : currentPrice * 0.99;
  const entryRangeHigh = entryPrices.length > 0 ? Math.max(...entryPrices) : currentPrice * 1.01;

  const signalData = {
    coin, direction,
    elite_count: eliteCount, good_count: goodCount, total_traders: allTraders.length,
    combined_pnl_7d: combinedPnl7d, combined_pnl_30d: combinedPnl30d, combined_account_value: combinedAccountValue,
    avg_win_rate: avgWinRate, avg_profit_factor: avgProfitFactor, total_position_value: totalPositionValue,
    avg_entry_price: currentPrice, avg_leverage: avgLeverage, traders: allTraders,
    signal_tier: signalTier, signal_strength: determineSignalStrength(eliteCount, goodCount), confidence,
    directional_agreement: 1.0, opposing_traders: 0,
    suggested_entry: currentPrice, entry_price: currentPrice,
    entry_range_low: entryRangeLow, entry_range_high: entryRangeHigh,
    stop_loss: stopData.stopLoss, stop_distance_pct: stopData.stopDistancePct,
    take_profit_1: tps.tp1, take_profit_2: tps.tp2, take_profit_3: tps.tp3,
    suggested_leverage: suggestedLeverage, risk_score: riskScore,
    avg_conviction_pct: avgConvictionPct, funding_context: fundingData.context, current_funding_rate: fundingData.fundingRate,
    volatility_adjusted_stop: stopData.stopLoss, atr_multiple: stopData.atrMultiple,
    current_price: currentPrice, is_active: true, outcome: 'open',
    entry_detected_at: detected_at.toISOString(), is_verified_open: true,
    trigger_event_id: change.id || null,
    expires_at: new Date(Date.now() + config.signals.expiryHours * 60 * 60 * 1000).toISOString(),
  };

  const { error } = await db.client.from('quality_signals').insert(signalData);

  if (error) {
    logger.error(`Failed to create signal for ${coin}`, error);
    return;
  }

  const tierEmoji = signalTier === 'elite_entry' ? '⚡' : signalTier === 'consensus' ? '🚨🚨' : '🚨';
  logger.info(
    `${tierEmoji} NEW ${signalTier.toUpperCase()} SIGNAL: ${coin} ${direction.toUpperCase()} | ` +
    `${eliteCount}E + ${goodCount}G | Entry: $${currentPrice.toFixed(4)} | Stop: ${stopData.stopDistancePct.toFixed(1)}% | ` +
    `Confidence: ${confidence}%`
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

  const allTraders = await getAllTradersInPosition(coin, direction, true);
  const avgConvictionPct = allTraders.reduce((sum, t) => sum + t.conviction_pct, 0) / allTraders.length;
  const totalPositionValue = allTraders.reduce((sum, t) => sum + t.position_value, 0);

  await db.client
    .from('quality_signals')
    .update({ traders: allTraders, avg_conviction_pct: avgConvictionPct, total_position_value: totalPositionValue, updated_at: new Date().toISOString() })
    .eq('id', existingSignal.id);

  logger.info(`📈 ${coin} ${direction}: ${address.slice(0, 8)}... added +${change.size_change.toFixed(4)} @ $${change.price_at_event.toFixed(2)}`);
}

async function handleDecreaseEvent(change: PositionChange): Promise<void> {
  const { coin, direction } = change;
  
  const existingSignal = await getActiveSignalForCoin(coin, direction);
  if (!existingSignal) return;

  const allTraders = await getAllTradersInPosition(coin, direction, false);
  
  if (allTraders.length === 0) {
    await closeSignal(existingSignal, 'all_traders_exited');
    return;
  }

  const eliteCount = allTraders.filter(t => t.tier === 'elite').length;
  const goodCount = allTraders.filter(t => t.tier === 'good').length;
  const newTier = determineSignalTier(eliteCount, goodCount);

  await db.client
    .from('quality_signals')
    .update({
      elite_count: eliteCount, good_count: goodCount, total_traders: allTraders.length, traders: allTraders,
      avg_conviction_pct: allTraders.reduce((sum, t) => sum + t.conviction_pct, 0) / allTraders.length,
      total_position_value: allTraders.reduce((sum, t) => sum + t.position_value, 0),
      signal_tier: newTier, updated_at: new Date().toISOString(),
    })
    .eq('id', existingSignal.id);
}

async function handleCloseEvent(change: PositionChange): Promise<void> {
  const { address, coin, direction, price_at_event } = change;
  
  const existingSignal = await getActiveSignalForCoin(coin, direction);
  if (!existingSignal) return;

  const exitPrice = price_at_event || await hyperliquid.getMidPrice(coin) || 0;
  const updatedTradersWithExit = await updateTraderExitInSignal(existingSignal, address, exitPrice, 'manual');
  const allTraders = await getAllTradersInPosition(coin, direction, false);
  
  if (allTraders.length === 0) {
    await closeSignal(existingSignal, 'all_traders_exited', updatedTradersWithExit);
    return;
  }

  const eliteCount = allTraders.filter(t => t.tier === 'elite').length;
  const goodCount = allTraders.filter(t => t.tier === 'good').length;
  
  if (!shouldCreateSignal(eliteCount, goodCount)) {
    await closeSignal(existingSignal, 'below_minimum_traders', updatedTradersWithExit);
    return;
  }

  const exitedTraders = updatedTradersWithExit.filter(t => t.exit_price !== null);
  const mergedTraders = [...exitedTraders, ...allTraders];

  const combinedPnl7d = allTraders.reduce((sum, t) => sum + t.pnl_7d, 0);
  const avgWinRate = allTraders.reduce((sum, t) => sum + t.win_rate, 0) / allTraders.length;
  const avgProfitFactor = allTraders.reduce((sum, t) => sum + t.profit_factor, 0) / allTraders.length;
  const avgConvictionPct = allTraders.reduce((sum, t) => sum + t.conviction_pct, 0) / allTraders.length;
  const totalPositionValue = allTraders.reduce((sum, t) => sum + t.position_value, 0);

  const fundingData = await getSignalFundingContext(coin, direction as 'long' | 'short');
  const newTier = determineSignalTier(eliteCount, goodCount);
  const confidence = calculateConfidence(eliteCount, goodCount, avgWinRate, avgProfitFactor, combinedPnl7d, avgConvictionPct, fundingData.context, newTier);

  await db.client
    .from('quality_signals')
    .update({
      elite_count: eliteCount, good_count: goodCount, total_traders: allTraders.length,
      traders: mergedTraders, confidence, combined_pnl_7d: combinedPnl7d,
      avg_win_rate: avgWinRate, avg_profit_factor: avgProfitFactor,
      avg_conviction_pct: avgConvictionPct, total_position_value: totalPositionValue,
      signal_tier: newTier, signal_strength: determineSignalStrength(eliteCount, goodCount),
      updated_at: new Date().toISOString(),
    })
    .eq('id', existingSignal.id);

  logger.info(`📉 ${coin} ${direction}: ${address.slice(0, 8)}... exited @ $${exitPrice.toFixed(2)} | Now ${eliteCount}E + ${goodCount}G`);
}

async function handleFlipEvent(change: PositionChange): Promise<void> {
  const oldDirection = change.direction === 'long' ? 'short' : 'long';
  const oldSignal = await getActiveSignalForCoin(change.coin, oldDirection);
  if (oldSignal) await closeSignal(oldSignal, 'trader_flipped_direction');
  await handleOpenEvent(change);
}

async function closeSignal(signal: ActiveSignal, reason: string, tradersWithExitData?: TraderForSignal[]): Promise<void> {
  const currentPrice = await hyperliquid.getMidPrice(signal.coin);
  const closedAt = new Date().toISOString();
  
  let pnlPct = 0;
  if (currentPrice && signal.entry_price) {
    pnlPct = signal.direction === 'long'
      ? ((currentPrice - signal.entry_price) / signal.entry_price) * 100
      : ((signal.entry_price - currentPrice) / signal.entry_price) * 100;
  }

  let finalTraders = tradersWithExitData || signal.traders || [];
  finalTraders = finalTraders.map(trader => {
    if (trader.exit_price === null || trader.exit_price === undefined) {
      return { ...trader, exit_price: currentPrice || signal.entry_price, exited_at: closedAt, exit_type: 'signal_closed' as ExitType };
    }
    return trader;
  });

  await db.client
    .from('quality_signals')
    .update({
      is_active: false, invalidated: true, invalidation_reason: reason,
      outcome: pnlPct > 0 ? 'profit' : 'loss', final_pnl_pct: pnlPct,
      current_price: currentPrice, closed_at: closedAt, traders: finalTraders,
    })
    .eq('id', signal.id);

  logger.info(`🔴 Signal closed: ${signal.coin} ${signal.direction} | ${reason} | P&L: ${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(2)}%`);
}

// ============================================
// MAIN: Process Position Changes
// ============================================

export async function processPositionChanges(changes: PositionChange[]): Promise<void> {
  for (const change of changes) {
    try {
      switch (change.event_type) {
        case 'open': await handleOpenEvent(change); break;
        case 'increase': await handleIncreaseEvent(change); break;
        case 'decrease': await handleDecreaseEvent(change); break;
        case 'close': await handleCloseEvent(change); break;
        case 'flip': await handleFlipEvent(change); break;
      }
    } catch (error) {
      logger.error(`Error processing ${change.event_type} for ${change.coin}`, error);
    }
  }
}

// ============================================
// Price Monitoring
// ============================================

async function checkPriceTargets(): Promise<void> {
  const { data: activeSignals } = await db.client.from('quality_signals').select('*').eq('is_active', true);
  if (!activeSignals || activeSignals.length === 0) return;

  for (const signal of activeSignals) {
    const currentPrice = await hyperliquid.getMidPrice(signal.coin);
    if (!currentPrice) continue;

    const direction = signal.direction as 'long' | 'short';
    const closedAt = new Date().toISOString();
    
    // Calculate current P&L
    const currentPnlPct = signal.entry_price
      ? (direction === 'long'
          ? ((currentPrice - signal.entry_price) / signal.entry_price) * 100
          : ((signal.entry_price - currentPrice) / signal.entry_price) * 100)
      : 0;

    // Track peak/trough prices
    const peakPrice = signal.peak_price 
      ? (direction === 'long' ? Math.max(signal.peak_price, currentPrice) : Math.min(signal.peak_price, currentPrice))
      : currentPrice;
    const troughPrice = signal.trough_price
      ? (direction === 'long' ? Math.min(signal.trough_price, currentPrice) : Math.max(signal.trough_price, currentPrice))
      : currentPrice;
    
    // Calculate max P&L reached (for trailing stop)
    const maxPnlPct = Math.max(signal.max_pnl_pct || 0, currentPnlPct);
    const minPnlPct = Math.min(signal.min_pnl_pct || 0, currentPnlPct);

    // V12.2: Calculate signal age
    const signalAgeHours = signal.created_at 
      ? (Date.now() - new Date(signal.created_at).getTime()) / (1000 * 60 * 60)
      : 0;

    // Exit conditions
    const hitStop = direction === 'long' ? currentPrice <= signal.stop_loss : currentPrice >= signal.stop_loss;
    const hitFixedTp = currentPnlPct >= FIXED_TP_PCT;
    const hitTimeStop = signalAgeHours >= MAX_SIGNAL_AGE_HOURS;
    
    // V12.2: Trailing stop - activates after hitting TRAILING_STOP_ACTIVATE_PCT
    // If we've reached +0.5% at some point and then dropped TRAILING_STOP_DISTANCE_PCT from peak
    const trailingStopActive = maxPnlPct >= TRAILING_STOP_ACTIVATE_PCT;
    const hitTrailingStop = trailingStopActive && (maxPnlPct - currentPnlPct) >= TRAILING_STOP_DISTANCE_PCT;

    // Helper to close signal
    const closeSignalWithReason = async (outcome: string, reason: string) => {
      const tradersWithExit = (signal.traders || []).map((trader: TraderForSignal) => ({
        ...trader, 
        exit_price: trader.exit_price ?? currentPrice, 
        exited_at: trader.exited_at ?? closedAt, 
        exit_type: trader.exit_type ?? 'manual' as ExitType,
      }));

      await db.client.from('quality_signals').update({
        is_active: false, 
        outcome,
        invalidation_reason: reason,
        hit_stop: hitStop,
        hit_tp1: currentPnlPct >= (signal.stop_distance_pct || 5),
        hit_tp2: currentPnlPct >= (signal.stop_distance_pct || 5) * 2,
        hit_tp3: currentPnlPct >= (signal.stop_distance_pct || 5) * 3,
        final_pnl_pct: currentPnlPct, 
        current_price: currentPrice, 
        closed_at: closedAt,
        peak_price: peakPrice,
        trough_price: troughPrice,
        max_pnl_pct: maxPnlPct,
        min_pnl_pct: minPnlPct,
        traders: tradersWithExit,
      }).eq('id', signal.id);
    };

    // Priority order for exit conditions
    if (hitStop) {
      await closeSignalWithReason('stopped_out', 'stop_loss_hit');
      logger.info(`🛑 STOP HIT: ${signal.coin} ${signal.direction} | P&L: ${currentPnlPct.toFixed(2)}%`);
    } 
    else if (hitFixedTp) {
      await closeSignalWithReason('tp_hit', `fixed_tp_${FIXED_TP_PCT}pct`);
      logger.info(`🎯 FIXED TP HIT: ${signal.coin} ${signal.direction} | P&L: +${currentPnlPct.toFixed(2)}% (target: +${FIXED_TP_PCT}%)`);
    }
    else if (hitTrailingStop) {
      await closeSignalWithReason('trailing_stop', `trailing_stop_from_${maxPnlPct.toFixed(2)}pct`);
      logger.info(`📉 TRAILING STOP: ${signal.coin} ${signal.direction} | P&L: +${currentPnlPct.toFixed(2)}% (peak was +${maxPnlPct.toFixed(2)}%)`);
    }
    else if (hitTimeStop) {
      await closeSignalWithReason('time_stop', `exceeded_${MAX_SIGNAL_AGE_HOURS}h`);
      logger.info(`⏰ TIME STOP: ${signal.coin} ${signal.direction} | P&L: ${currentPnlPct >= 0 ? '+' : ''}${currentPnlPct.toFixed(2)}% | Age: ${signalAgeHours.toFixed(1)}h`);
    }
    else {
      // Just update tracking data
      await db.client.from('quality_signals').update({
        current_price: currentPrice, 
        current_pnl_pct: currentPnlPct,
        peak_price: peakPrice, 
        trough_price: troughPrice,
        max_pnl_pct: maxPnlPct,
        min_pnl_pct: minPnlPct,
        hit_tp1: currentPnlPct >= (signal.stop_distance_pct || 5),
        hit_tp2: currentPnlPct >= (signal.stop_distance_pct || 5) * 2,
        updated_at: new Date().toISOString(),
      }).eq('id', signal.id);
    }
  }
}

// ============================================
// Initialization
// ============================================

let priceCheckInterval: NodeJS.Timeout | null = null;
let tierUpdateInterval: NodeJS.Timeout | null = null;

export function initializeSignalGenerator(): void {
  logger.info(`Signal Generator V12.2 initializing...`);
  logger.info(`  - Fresh positions only: ${MAX_POSITION_AGE_HOURS}h max age`);
  logger.info(`  - Exit strategy: ${FIXED_TP_PCT}% TP | ${MAX_SIGNAL_AGE_HOURS}h time stop | trailing after +${TRAILING_STOP_ACTIVATE_PCT}%`);
  logger.info(`  - Coin blacklist: ${COIN_BLACKLIST.join(', ')}`);
  
  subscribeToPositionChanges(processPositionChanges);
  
  priceCheckInterval = setInterval(checkPriceTargets, 60 * 1000);
  tierUpdateInterval = setInterval(updateSignalTraderTiers, 5 * 60 * 1000);
  
  logger.info('Signal Generator V12.2 ready - filters stale positions, tracks per-trader exit data');
}

export function stopSignalGenerator(): void {
  if (priceCheckInterval) { clearInterval(priceCheckInterval); priceCheckInterval = null; }
  if (tierUpdateInterval) { clearInterval(tierUpdateInterval); tierUpdateInterval = null; }
  logger.info('Signal Generator V12.2 stopped');
}

// ============================================
// Exports
// ============================================

export async function getActiveSignals(): Promise<unknown[]> {
  const { data } = await db.client.from('quality_signals').select('*').eq('is_active', true).order('confidence', { ascending: false });
  return data || [];
}

export async function getSignalForCoin(coin: string): Promise<unknown | null> {
  const { data } = await db.client.from('quality_signals').select('*').eq('coin', coin).eq('is_active', true).single();
  return data;
}

export async function getVerifiedSignals(): Promise<unknown[]> {
  const { data } = await db.client.from('quality_signals').select('*').eq('is_active', true).eq('is_verified_open', true).order('entry_detected_at', { ascending: false });
  return data || [];
}

export async function generateSignals(): Promise<void> {
  logger.debug('generateSignals() - V12.2 is event-driven');
}

export default {
  initializeSignalGenerator, stopSignalGenerator, processPositionChanges, updateSignalTraderTiers,
  getActiveSignals, getSignalForCoin, getVerifiedSignals, generateSignals,
};