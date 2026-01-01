// Signal Generator V4
// Enhanced with:
// - Position conviction scoring (capped at 100%)
// - Volatility-adjusted stop losses (uses cached ATR data)
// - Funding rate context (favorable/unfavorable)
// - Pending order awareness
// - Real-time fill integration

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import hyperliquid from '../utils/hyperliquid-api.js';
import { getSignalFundingContext } from './funding-tracker.js';

const logger = createLogger('signal-generator-v4');

// ============================================
// Types
// ============================================

interface TraderPosition {
  address: string;
  coin: string;
  direction: 'long' | 'short';
  size: number;
  entry_price: number;
  value_usd: number;
  leverage: number;
  unrealized_pnl: number;
  liquidation_price: number | null;
  has_pending_entry: boolean;
  has_stop_order: boolean;
}

interface TraderQuality {
  address: string;
  quality_tier: 'elite' | 'good';
  pnl_7d: number;
  pnl_30d: number;
  win_rate: number;
  profit_factor: number;
  account_value: number;
}

interface TraderWithPosition {
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
}

interface SignalCandidate {
  coin: string;
  direction: 'long' | 'short';
  eliteTraders: TraderWithPosition[];
  goodTraders: TraderWithPosition[];
  opposingTraders: number;
  directionalAgreement: number;
  combinedPnl7d: number;
  combinedPnl30d: number;
  avgWinRate: number;
  avgProfitFactor: number;
  totalPositionValue: number;
  avgConvictionPct: number;
  maxConvictionPct: number;
  tradersWithStops: number;
  suggestedEntry: number;
  entryRangeLow: number;
  entryRangeHigh: number;
  stopLoss: number;
  stopDistancePct: number;
  volatilityAdjustedStop: number;
  atrMultiple: number;
  volatilityRank: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  fundingContext: 'favorable' | 'neutral' | 'unfavorable';
  currentFundingRate: number;
  avgLeverage: number;
  suggestedLeverage: number;
  riskScore: number;
  confidence: number;
  signalStrength: 'strong' | 'medium';
}

// ============================================
// Core Functions
// ============================================

async function getCurrentPrice(coin: string): Promise<number | null> {
  return hyperliquid.getMidPrice(coin);
}

function calculateDirectionalAgreement(
  longCount: number,
  shortCount: number
): { direction: 'long' | 'short'; agreement: number } {
  const total = longCount + shortCount;
  if (total === 0) return { direction: 'long', agreement: 0 };
  
  if (longCount >= shortCount) {
    return { direction: 'long', agreement: longCount / total };
  } else {
    return { direction: 'short', agreement: shortCount / total };
  }
}

/**
 * V4: Enhanced stop loss using CACHED volatility data (no API calls)
 */
async function calculateEnhancedStopLoss(
  coin: string,
  direction: 'long' | 'short',
  traders: TraderWithPosition[],
  currentPrice: number
): Promise<{
  stopLoss: number;
  stopDistancePct: number;
  volatilityAdjustedStop: number;
  atrMultiple: number;
  volatilityRank: number;
}> {
  // Use cached volatility only - NO API calls here
  const { data: volData } = await db.client
    .from('coin_volatility')
    .select('*')
    .eq('coin', coin)
    .single();

  let stopDistancePct = 3; // Default 3%
  let volatilityRank = 50;
  
  if (volData && volData.atr_14d && volData.last_price) {
    const atrPct = (parseFloat(volData.atr_14d) / parseFloat(volData.last_price)) * 100;
    stopDistancePct = Math.max(
      config.volatility.minStopPct, 
      Math.min(config.volatility.maxStopPct, atrPct * config.volatility.defaultAtrMultiple)
    );
    volatilityRank = volData.volatility_rank || 50;
  }

  // Consider liquidation prices as backstop
  const liqPrices = traders
    .map(t => t.liquidation_price)
    .filter((p): p is number => p !== null && p > 0);

  let stopLoss: number;
  
  if (direction === 'long') {
    stopLoss = currentPrice * (1 - stopDistancePct / 100);
    if (liqPrices.length > 0) {
      const liqBasedStop = Math.max(...liqPrices) * 1.15;
      stopLoss = Math.max(stopLoss, liqBasedStop);
    }
    // Ensure at least 1% away
    stopLoss = Math.min(stopLoss, currentPrice * 0.99);
  } else {
    stopLoss = currentPrice * (1 + stopDistancePct / 100);
    if (liqPrices.length > 0) {
      const liqBasedStop = Math.min(...liqPrices) * 0.85;
      stopLoss = Math.min(stopLoss, liqBasedStop);
    }
    // Ensure at least 1% away
    stopLoss = Math.max(stopLoss, currentPrice * 1.01);
  }

  const finalStopDistancePct = Math.abs(stopLoss - currentPrice) / currentPrice * 100;

  return {
    stopLoss,
    stopDistancePct: finalStopDistancePct,
    volatilityAdjustedStop: stopLoss,
    atrMultiple: config.volatility.defaultAtrMultiple,
    volatilityRank,
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

function calculateSuggestedLeverage(
  traders: TraderWithPosition[],
  stopDistancePct: number
): number {
  const avgLeverage = traders.reduce((sum, t) => sum + t.leverage, 0) / traders.length;
  const maxRiskPct = 0.02;
  const safeLeverage = (maxRiskPct * 100) / stopDistancePct;
  
  return Math.min(
    Math.round(Math.min(avgLeverage * 0.8, safeLeverage)),
    config.signals.maxSuggestedLeverage
  );
}

function calculateConfidence(
  eliteCount: number,
  goodCount: number,
  agreement: number,
  avgWinRate: number,
  avgProfitFactor: number,
  combinedPnl7d: number,
  avgConvictionPct: number,
  fundingContext: string,
  tradersWithStops: number,
  totalTraders: number
): number {
  let confidence = 0;

  // Trader count (0-25)
  if (eliteCount >= 3) confidence += 25;
  else if (eliteCount >= 2) confidence += 20;
  else if (eliteCount >= 1) confidence += 15;
  else if (goodCount >= 4) confidence += 12;
  else if (goodCount >= 3) confidence += 8;

  // Directional agreement (0-20)
  if (agreement >= 0.9) confidence += 20;
  else if (agreement >= 0.8) confidence += 15;
  else if (agreement >= 0.7) confidence += 10;
  else confidence += 5;

  // Win rate (0-15)
  if (avgWinRate >= 0.6) confidence += 15;
  else if (avgWinRate >= 0.55) confidence += 12;
  else if (avgWinRate >= 0.5) confidence += 8;
  else confidence += 4;

  // Profit factor (0-10)
  if (avgProfitFactor >= 2.0) confidence += 10;
  else if (avgProfitFactor >= 1.5) confidence += 7;
  else if (avgProfitFactor >= 1.2) confidence += 4;

  // Combined PnL (0-10)
  if (combinedPnl7d >= 100000) confidence += 10;
  else if (combinedPnl7d >= 50000) confidence += 7;
  else if (combinedPnl7d >= 25000) confidence += 5;
  else if (combinedPnl7d >= 10000) confidence += 3;

  // V4: Conviction scoring (0-10)
  if (avgConvictionPct >= 30) confidence += 10;
  else if (avgConvictionPct >= 20) confidence += 7;
  else if (avgConvictionPct >= 10) confidence += 4;
  else if (avgConvictionPct >= 5) confidence += 2;

  // V4: Funding context (0-5)
  if (fundingContext === 'favorable') confidence += 5;
  else if (fundingContext === 'neutral') confidence += 2;

  // V4: Traders with stop orders (0-5)
  const stopRatio = totalTraders > 0 ? tradersWithStops / totalTraders : 0;
  if (stopRatio >= 0.5) confidence += 5;
  else if (stopRatio >= 0.25) confidence += 2;

  return Math.min(100, confidence);
}

function calculateRiskScore(
  agreement: number,
  avgProfitFactor: number,
  avgWinRate: number,
  stopDistancePct: number,
  eliteCount: number,
  volatilityRank: number,
  fundingContext: string
): number {
  let risk = 50;

  risk -= eliteCount * 5;

  if (agreement >= 0.9) risk -= 15;
  else if (agreement >= 0.8) risk -= 10;
  else if (agreement >= 0.7) risk -= 5;

  if (avgProfitFactor >= 2.0) risk -= 10;
  else if (avgProfitFactor >= 1.5) risk -= 5;

  if (avgWinRate >= 0.6) risk -= 10;
  else if (avgWinRate >= 0.55) risk -= 5;

  if (stopDistancePct > 5) risk += 10;
  else if (stopDistancePct > 3) risk += 5;

  if (volatilityRank >= 80) risk += 15;
  else if (volatilityRank >= 60) risk += 10;
  else if (volatilityRank >= 40) risk += 5;

  if (fundingContext === 'unfavorable') risk += 10;

  return Math.max(0, Math.min(100, risk));
}

function meetsSignalRequirements(candidate: SignalCandidate): boolean {
  const { signals } = config;
  const eliteCount = candidate.eliteTraders.length;
  const goodCount = candidate.goodTraders.length;

  const hasMinElite = eliteCount >= signals.minEliteForSignal;
  const hasMinGood = goodCount >= signals.minGoodForSignal;
  const hasMinMixed = eliteCount >= signals.minMixedForSignal.elite && 
                      goodCount >= signals.minMixedForSignal.good;

  if (!hasMinElite && !hasMinGood && !hasMinMixed) {
    return false;
  }

  if (candidate.directionalAgreement < signals.minDirectionalAgreement) {
    return false;
  }

  if (candidate.combinedPnl7d < signals.minCombinedPnl7d) {
    return false;
  }

  if (candidate.avgWinRate < signals.minAvgWinRate) {
    return false;
  }

  if (candidate.avgProfitFactor < signals.minAvgProfitFactor) {
    return false;
  }

  return true;
}

function determineSignalStrength(eliteCount: number, goodCount: number): 'strong' | 'medium' {
  const { strongSignal } = config.signals;

  if (eliteCount >= strongSignal.minElite) return 'strong';
  if (goodCount >= strongSignal.minGood) return 'strong';
  if (eliteCount >= strongSignal.minMixed.elite && 
      goodCount >= strongSignal.minMixed.good) return 'strong';

  return 'medium';
}

// ============================================
// Main Signal Generation
// ============================================

export async function generateSignals(): Promise<void> {
  try {
    const { data: positions, error: posError } = await db.client
      .from('trader_positions')
      .select('*');

    if (posError || !positions || positions.length === 0) {
      logger.debug('No positions to analyze');
      return;
    }

    const { data: traders, error: traderError } = await db.client
      .from('trader_quality')
      .select('address, quality_tier, pnl_7d, pnl_30d, win_rate, profit_factor, account_value')
      .eq('is_tracked', true)
      .in('quality_tier', ['elite', 'good']);

    if (traderError || !traders) {
      logger.error('Failed to get trader data');
      return;
    }

    const traderMap = new Map<string, TraderQuality>();
    for (const t of traders) {
      traderMap.set(t.address, t as TraderQuality);
    }

    const positionsByCoin = new Map<string, TraderPosition[]>();
    for (const pos of positions) {
      const existing = positionsByCoin.get(pos.coin) || [];
      existing.push(pos as TraderPosition);
      positionsByCoin.set(pos.coin, existing);
    }

    const validSignals: unknown[] = [];

    for (const [coin, coinPositions] of positionsByCoin) {
      const longs = coinPositions.filter(p => p.direction === 'long');
      const shorts = coinPositions.filter(p => p.direction === 'short');

      const longQuality = longs.filter(p => {
        const t = traderMap.get(p.address);
        return t && (t.quality_tier === 'elite' || t.quality_tier === 'good');
      });
      const shortQuality = shorts.filter(p => {
        const t = traderMap.get(p.address);
        return t && (t.quality_tier === 'elite' || t.quality_tier === 'good');
      });

      const { direction, agreement } = calculateDirectionalAgreement(
        longQuality.length,
        shortQuality.length
      );

      if (agreement < config.signals.minDirectionalAgreement) {
        continue;
      }

      const dominantPositions = direction === 'long' ? longQuality : shortQuality;
      const opposingCount = direction === 'long' ? shortQuality.length : longQuality.length;

      const eliteTraders: TraderWithPosition[] = [];
      const goodTraders: TraderWithPosition[] = [];

      for (const pos of dominantPositions) {
        const trader = traderMap.get(pos.address);
        if (!trader) continue;

        // FIX: Cap conviction at 100%
        const rawConviction = trader.account_value > 0
          ? (pos.value_usd / trader.account_value) * 100
          : 0;
        const convictionPct = Math.min(100, rawConviction);

        const traderWithPos: TraderWithPosition = {
          address: pos.address,
          tier: trader.quality_tier as 'elite' | 'good',
          pnl_7d: trader.pnl_7d || 0,
          pnl_30d: trader.pnl_30d || 0,
          win_rate: trader.win_rate || 0,
          profit_factor: trader.profit_factor || 1,
          entry_price: pos.entry_price,
          position_value: pos.value_usd,
          leverage: pos.leverage || 1,
          liquidation_price: pos.liquidation_price,
          conviction_pct: convictionPct,
          has_stop_order: pos.has_stop_order || false,
        };

        if (trader.quality_tier === 'elite') {
          eliteTraders.push(traderWithPos);
        } else {
          goodTraders.push(traderWithPos);
        }
      }

      const allTraders = [...eliteTraders, ...goodTraders];
      if (allTraders.length === 0) continue;

      const combinedPnl7d = allTraders.reduce((sum, t) => sum + t.pnl_7d, 0);
      const combinedPnl30d = allTraders.reduce((sum, t) => sum + t.pnl_30d, 0);
      const avgWinRate = allTraders.reduce((sum, t) => sum + t.win_rate, 0) / allTraders.length;
      const avgProfitFactor = allTraders.reduce((sum, t) => sum + t.profit_factor, 0) / allTraders.length;
      const totalPositionValue = allTraders.reduce((sum, t) => sum + t.position_value, 0);
      const avgLeverage = allTraders.reduce((sum, t) => sum + t.leverage, 0) / allTraders.length;

      // V4: Conviction metrics (already capped at 100%)
      const avgConvictionPct = allTraders.reduce((sum, t) => sum + t.conviction_pct, 0) / allTraders.length;
      const maxConvictionPct = Math.max(...allTraders.map(t => t.conviction_pct));
      const tradersWithStops = allTraders.filter(t => t.has_stop_order).length;

      const currentPrice = await getCurrentPrice(coin);
      if (!currentPrice) continue;

      const entryPrices = allTraders.map(t => t.entry_price).filter(p => p > 0);
      const suggestedEntry = currentPrice;
      const entryRangeLow = entryPrices.length > 0 ? Math.min(...entryPrices) : currentPrice * 0.99;
      const entryRangeHigh = entryPrices.length > 0 ? Math.max(...entryPrices) : currentPrice * 1.01;

      // V4: Enhanced stop loss using CACHED volatility (no API calls)
      const stopData = await calculateEnhancedStopLoss(coin, direction, allTraders, currentPrice);

      const { tp1, tp2, tp3 } = calculateTakeProfits(direction, suggestedEntry, stopData.stopLoss);

      const suggestedLeverage = calculateSuggestedLeverage(allTraders, stopData.stopDistancePct);

      // V4: Get funding context
      const fundingData = await getSignalFundingContext(coin, direction);

      const candidate: SignalCandidate = {
        coin,
        direction,
        eliteTraders,
        goodTraders,
        opposingTraders: opposingCount,
        directionalAgreement: agreement,
        combinedPnl7d,
        combinedPnl30d,
        avgWinRate,
        avgProfitFactor,
        totalPositionValue,
        avgConvictionPct,
        maxConvictionPct,
        tradersWithStops,
        suggestedEntry,
        entryRangeLow,
        entryRangeHigh,
        stopLoss: stopData.stopLoss,
        stopDistancePct: stopData.stopDistancePct,
        volatilityAdjustedStop: stopData.volatilityAdjustedStop,
        atrMultiple: stopData.atrMultiple,
        volatilityRank: stopData.volatilityRank,
        takeProfit1: tp1,
        takeProfit2: tp2,
        takeProfit3: tp3,
        fundingContext: fundingData.context,
        currentFundingRate: fundingData.fundingRate,
        avgLeverage,
        suggestedLeverage,
        riskScore: 0,
        confidence: 0,
        signalStrength: 'medium',
      };

      if (!meetsSignalRequirements(candidate)) {
        continue;
      }

      candidate.riskScore = calculateRiskScore(
        agreement,
        avgProfitFactor,
        avgWinRate,
        stopData.stopDistancePct,
        eliteTraders.length,
        stopData.volatilityRank,
        fundingData.context
      );

      candidate.confidence = calculateConfidence(
        eliteTraders.length,
        goodTraders.length,
        agreement,
        avgWinRate,
        avgProfitFactor,
        combinedPnl7d,
        avgConvictionPct,
        fundingData.context,
        tradersWithStops,
        allTraders.length
      );

      candidate.signalStrength = determineSignalStrength(eliteTraders.length, goodTraders.length);

      const signalData = {
        coin,
        direction,
        elite_count: eliteTraders.length,
        good_count: goodTraders.length,
        total_traders: allTraders.length,
        combined_pnl_7d: combinedPnl7d,
        combined_pnl_30d: combinedPnl30d,
        combined_account_value: allTraders.reduce((sum, t) => sum + (traderMap.get(t.address)?.account_value || 0), 0),
        avg_win_rate: avgWinRate,
        avg_profit_factor: avgProfitFactor,
        total_position_value: totalPositionValue,
        avg_entry_price: suggestedEntry,
        avg_leverage: avgLeverage,
        traders: allTraders,
        signal_strength: candidate.signalStrength,
        confidence: candidate.confidence,
        directional_agreement: agreement,
        opposing_traders: opposingCount,
        suggested_entry: suggestedEntry,
        entry_range_low: entryRangeLow,
        entry_range_high: entryRangeHigh,
        stop_loss: stopData.stopLoss,
        stop_distance_pct: stopData.stopDistancePct,
        take_profit_1: tp1,
        take_profit_2: tp2,
        take_profit_3: tp3,
        suggested_leverage: suggestedLeverage,
        risk_score: candidate.riskScore,
        avg_conviction_pct: avgConvictionPct,
        funding_context: fundingData.context,
        current_funding_rate: fundingData.fundingRate,
        volatility_adjusted_stop: stopData.volatilityAdjustedStop,
        atr_multiple: stopData.atrMultiple,
        is_active: true,
        expires_at: new Date(Date.now() + config.signals.expiryHours * 60 * 60 * 1000).toISOString(),
      };

      validSignals.push(signalData);

      const fundingTag = fundingData.context === 'favorable' ? '✅' : 
                        fundingData.context === 'unfavorable' ? '⚠️' : '';
      const convictionTag = avgConvictionPct >= 20 ? '💪' : '';
      
      logger.info(
        `Signal: ${coin} ${direction.toUpperCase()} | ` +
        `${eliteTraders.length}E + ${goodTraders.length}G | ` +
        `${(agreement * 100).toFixed(0)}% agree | ` +
        `${avgConvictionPct.toFixed(1)}% conv${convictionTag} | ` +
        `${fundingData.context}${fundingTag} | ` +
        `Stop: ${stopData.stopDistancePct.toFixed(1)}% | ` +
        `${candidate.signalStrength.toUpperCase()} (${candidate.confidence}%)`
      );
    }

    const activeCoinDirections = new Set(validSignals.map((s: any) => `${s.coin}-${s.direction}`));

    const { data: existingSignals } = await db.client
      .from('quality_signals')
      .select('id, coin, direction')
      .eq('is_active', true);

    if (existingSignals) {
      for (const existing of existingSignals) {
        const key = `${existing.coin}-${existing.direction}`;
        if (!activeCoinDirections.has(key)) {
          await db.client
            .from('quality_signals')
            .update({
              is_active: false,
              invalidated: true,
              invalidation_reason: 'no_longer_qualifies',
            })
            .eq('id', existing.id);
        }
      }
    }

    for (const signal of validSignals) {
      await db.client
        .from('quality_signals')
        .upsert(signal as any, { onConflict: 'coin,direction' });
    }

    logger.info(`Active signals: ${validSignals.length}`);

  } catch (error) {
    logger.error('Signal generation failed', error);
  }
}

// ============================================
// Exports
// ============================================

export async function getActiveSignals(): Promise<unknown[]> {
  const { data, error } = await db.client
    .from('quality_signals')
    .select('*')
    .eq('is_active', true)
    .order('confidence', { ascending: false });

  if (error) {
    logger.error('Failed to get active signals', error);
    return [];
  }

  return data || [];
}

export async function getSignalForCoin(coin: string): Promise<unknown | null> {
  const { data, error } = await db.client
    .from('quality_signals')
    .select('*')
    .eq('coin', coin)
    .eq('is_active', true)
    .single();

  if (error) return null;
  return data;
}

export async function getSignalsWithFavorableFunding(): Promise<unknown[]> {
  const { data } = await db.client
    .from('quality_signals')
    .select('*')
    .eq('is_active', true)
    .eq('funding_context', 'favorable')
    .order('confidence', { ascending: false });

  return data || [];
}

export async function getHighConvictionSignals(minConviction: number = 20): Promise<unknown[]> {
  const { data } = await db.client
    .from('quality_signals')
    .select('*')
    .eq('is_active', true)
    .gte('avg_conviction_pct', minConviction)
    .order('avg_conviction_pct', { ascending: false });

  return data || [];
}

export default {
  generateSignals,
  getActiveSignals,
  getSignalForCoin,
  getSignalsWithFavorableFunding,
  getHighConvictionSignals,
};