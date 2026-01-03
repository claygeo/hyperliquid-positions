// Signal Generator V9
// Enhanced from V8 with:
// - Confidence penalty when lead traders are underwater on position
// - Track lead trader unrealized P&L for frontend warning
// - Risk score adjustment based on current position health
// - Store lead_trader_underwater_pct in signal for UI display

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import hyperliquid from '../utils/hyperliquid-api.js';
import { getSignalFundingContext } from './funding-tracker.js';

const logger = createLogger('signal-generator-v9');

// ============================================
// V8: Volatility-Based Stop Configuration
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
  opened_at: string | null;
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
  opened_at: string | null;
  // V9: Track unrealized P&L for this position
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
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
  // V9: Track lead trader underwater percentage
  leadTraderUnderwaterPct: number;
}

interface ExistingSignal {
  id: number;
  coin: string;
  direction: string;
  elite_count: number;
  good_count: number;
  total_traders: number;
  created_at: string;
  entry_price: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  take_profit_3: number;
  hit_stop: boolean;
  hit_tp1: boolean;
  hit_tp2: boolean;
  hit_tp3: boolean;
  outcome: string;
  is_active: boolean;
  confidence: number;
  expires_at?: string;
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

async function calculateEnhancedStopLoss(
  coin: string,
  direction: 'long' | 'short',
  traders: TraderWithPosition[],
  entryPrice: number
): Promise<{
  stopLoss: number;
  stopDistancePct: number;
  volatilityAdjustedStop: number;
  atrMultiple: number;
  volatilityRank: number;
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

  logger.debug(
    `${coin} stop calc: ATR=${atrPct.toFixed(2)}%, ` +
    `volRank=${volatilityRank}, ` +
    `mult=${stopConfig.multiplier}, ` +
    `range=[${stopConfig.minStop}-${stopConfig.maxStop}%], ` +
    `final=${stopDistancePct.toFixed(2)}%`
  );

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
    volatilityAdjustedStop: stopLoss,
    atrMultiple: stopConfig.multiplier,
    volatilityRank,
  };
}

function calculateTakeProfits(
  direction: 'long' | 'short',
  entry: number,
  stopLoss: number
): { tp1: number; tp2: number; tp3: number } {
  const riskDistance = Math.abs(entry - stopLoss);
  
  let tp1: number, tp2: number, tp3: number;
  
  if (direction === 'long') {
    tp1 = entry + riskDistance * 1;
    tp2 = entry + riskDistance * 2;
    tp3 = entry + riskDistance * 3;
    
    if (tp1 <= entry || tp2 <= entry || tp3 <= entry) {
      logger.error(`TP calculation error for LONG: entry=${entry}, stop=${stopLoss}, tp1=${tp1}`);
      tp1 = entry * 1.02;
      tp2 = entry * 1.04;
      tp3 = entry * 1.06;
    }
  } else {
    tp1 = entry - riskDistance * 1;
    tp2 = entry - riskDistance * 2;
    tp3 = entry - riskDistance * 3;
    
    if (tp1 >= entry || tp2 >= entry || tp3 >= entry) {
      logger.error(`TP calculation error for SHORT: entry=${entry}, stop=${stopLoss}, tp1=${tp1}`);
      tp1 = entry * 0.98;
      tp2 = entry * 0.96;
      tp3 = entry * 0.94;
    }
  }
  
  return { tp1, tp2, tp3 };
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

// ============================================
// V9: Calculate lead trader underwater percentage
// ============================================

function calculateLeadTraderUnderwaterPct(traders: TraderWithPosition[]): number {
  if (traders.length === 0) return 0;
  
  // Find lead trader (highest 7d P&L among elite, or highest among good)
  const elites = traders.filter(t => t.tier === 'elite');
  const goods = traders.filter(t => t.tier === 'good');
  
  let leadTrader: TraderWithPosition | null = null;
  
  if (elites.length > 0) {
    leadTrader = elites.reduce((best, t) => t.pnl_7d > best.pnl_7d ? t : best);
  } else if (goods.length > 0) {
    leadTrader = goods.reduce((best, t) => t.pnl_7d > best.pnl_7d ? t : best);
  }
  
  if (!leadTrader) return 0;
  
  // If unrealized_pnl_pct is negative, trader is underwater
  if (leadTrader.unrealized_pnl_pct < 0) {
    return Math.abs(leadTrader.unrealized_pnl_pct);
  }
  
  return 0; // Lead trader is in profit
}

// ============================================
// V9: Confidence with underwater penalty
// ============================================

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
  totalTraders: number,
  leadTraderUnderwaterPct: number = 0
): number {
  let confidence = 0;

  // Trader count scoring
  if (eliteCount >= 3) confidence += 25;
  else if (eliteCount >= 2) confidence += 20;
  else if (eliteCount >= 1) confidence += 15;
  else if (goodCount >= 4) confidence += 12;
  else if (goodCount >= 3) confidence += 8;

  // Agreement scoring
  if (agreement >= 0.9) confidence += 20;
  else if (agreement >= 0.8) confidence += 15;
  else if (agreement >= 0.7) confidence += 10;
  else confidence += 5;

  // Win rate scoring
  if (avgWinRate >= 0.6) confidence += 15;
  else if (avgWinRate >= 0.55) confidence += 12;
  else if (avgWinRate >= 0.5) confidence += 8;
  else confidence += 4;

  // Profit factor scoring
  if (avgProfitFactor >= 2.0) confidence += 10;
  else if (avgProfitFactor >= 1.5) confidence += 7;
  else if (avgProfitFactor >= 1.2) confidence += 4;

  // Combined P&L scoring
  if (combinedPnl7d >= 100000) confidence += 10;
  else if (combinedPnl7d >= 50000) confidence += 7;
  else if (combinedPnl7d >= 25000) confidence += 5;
  else if (combinedPnl7d >= 10000) confidence += 3;

  // Conviction scoring
  if (avgConvictionPct >= 30) confidence += 10;
  else if (avgConvictionPct >= 20) confidence += 7;
  else if (avgConvictionPct >= 10) confidence += 4;
  else if (avgConvictionPct >= 5) confidence += 2;

  // Funding context
  if (fundingContext === 'favorable') confidence += 5;
  else if (fundingContext === 'neutral') confidence += 2;

  // Stop orders
  const stopRatio = totalTraders > 0 ? tradersWithStops / totalTraders : 0;
  if (stopRatio >= 0.5) confidence += 5;
  else if (stopRatio >= 0.25) confidence += 2;

  // ============================================
  // V9: UNDERWATER PENALTY
  // Reduce confidence when lead traders are underwater
  // ============================================
  if (leadTraderUnderwaterPct > 0) {
    if (leadTraderUnderwaterPct >= 50) {
      // Severe: Lead trader down 50%+ on this position
      confidence -= 30;
      logger.debug(`Confidence -30: lead trader ${leadTraderUnderwaterPct.toFixed(1)}% underwater`);
    } else if (leadTraderUnderwaterPct >= 25) {
      // Major: Lead trader down 25-50%
      confidence -= 20;
      logger.debug(`Confidence -20: lead trader ${leadTraderUnderwaterPct.toFixed(1)}% underwater`);
    } else if (leadTraderUnderwaterPct >= 10) {
      // Moderate: Lead trader down 10-25%
      confidence -= 10;
      logger.debug(`Confidence -10: lead trader ${leadTraderUnderwaterPct.toFixed(1)}% underwater`);
    } else if (leadTraderUnderwaterPct >= 5) {
      // Minor: Lead trader down 5-10%
      confidence -= 5;
    }
  }

  return Math.max(0, Math.min(100, confidence));
}

// ============================================
// V9: Risk score with underwater factor
// ============================================

function calculateRiskScore(
  agreement: number,
  avgProfitFactor: number,
  avgWinRate: number,
  stopDistancePct: number,
  eliteCount: number,
  volatilityRank: number,
  fundingContext: string,
  leadTraderUnderwaterPct: number = 0
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

  if (stopDistancePct > 15) risk += 15;
  else if (stopDistancePct > 10) risk += 10;
  else if (stopDistancePct > 5) risk += 5;

  if (volatilityRank >= 80) risk += 15;
  else if (volatilityRank >= 60) risk += 10;
  else if (volatilityRank >= 40) risk += 5;

  if (fundingContext === 'unfavorable') risk += 10;

  // V9: Increase risk when lead trader is underwater
  if (leadTraderUnderwaterPct >= 25) risk += 20;
  else if (leadTraderUnderwaterPct >= 10) risk += 10;
  else if (leadTraderUnderwaterPct >= 5) risk += 5;

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

async function shouldKeepSignalAlive(
  existing: ExistingSignal,
  currentTraderCount: number,
  currentPrice: number
): Promise<{ keep: boolean; reason?: string }> {
  if (existing.outcome && existing.outcome !== 'open') {
    return { keep: false, reason: `outcome_${existing.outcome}` };
  }

  const ageHours = (Date.now() - new Date(existing.created_at).getTime()) / (1000 * 60 * 60);
  if (ageHours < 1) {
    return { keep: true };
  }

  if (currentTraderCount >= 1) {
    return { keep: true };
  }

  const direction = existing.direction as 'long' | 'short';
  if (direction === 'long' && currentPrice <= existing.stop_loss) {
    return { keep: false, reason: 'stop_loss_hit' };
  }
  if (direction === 'short' && currentPrice >= existing.stop_loss) {
    return { keep: false, reason: 'stop_loss_hit' };
  }

  if (direction === 'long' && currentPrice >= existing.take_profit_3) {
    return { keep: false, reason: 'take_profit_3_hit' };
  }
  if (direction === 'short' && currentPrice <= existing.take_profit_3) {
    return { keep: false, reason: 'take_profit_3_hit' };
  }

  const originalTraders = existing.total_traders;
  const exitRatio = 1 - (currentTraderCount / originalTraders);
  
  if (exitRatio >= 0.8) {
    return { keep: false, reason: `majority_exit_${Math.round(exitRatio * 100)}pct` };
  }

  return { keep: true };
}

async function deactivateClosedSignals(): Promise<number> {
  const { data, error } = await db.client
    .from('quality_signals')
    .update({ 
      is_active: false,
      invalidation_reason: 'outcome_closed'
    })
    .eq('is_active', true)
    .neq('outcome', 'open')
    .select('id, coin, direction, outcome');

  if (error) {
    logger.error('Failed to deactivate closed signals', error);
    return 0;
  }

  if (data && data.length > 0) {
    for (const sig of data) {
      logger.info(`Auto-deactivated: ${sig.coin} ${sig.direction} | outcome: ${sig.outcome}`);
    }
  }

  return data?.length || 0;
}

async function resolveConflictingSignals(): Promise<number> {
  const { data: activeSignals } = await db.client
    .from('quality_signals')
    .select('*')
    .eq('is_active', true);

  if (!activeSignals || activeSignals.length === 0) return 0;

  const byCoin = new Map<string, ExistingSignal[]>();
  for (const sig of activeSignals) {
    const existing = byCoin.get(sig.coin) || [];
    existing.push(sig as ExistingSignal);
    byCoin.set(sig.coin, existing);
  }

  let resolved = 0;

  for (const [coin, signals] of byCoin) {
    if (signals.length < 2) continue;

    const longSignals = signals.filter(s => s.direction === 'long');
    const shortSignals = signals.filter(s => s.direction === 'short');

    if (longSignals.length > 0 && shortSignals.length > 0) {
      const bestLong = longSignals.reduce((best, s) => 
        s.confidence > best.confidence ? s : best
      );
      const bestShort = shortSignals.reduce((best, s) => 
        s.confidence > best.confidence ? s : best
      );

      let toKeep: ExistingSignal;
      let toInvalidate: ExistingSignal[];

      if (bestLong.confidence > bestShort.confidence) {
        toKeep = bestLong;
        toInvalidate = shortSignals;
      } else if (bestShort.confidence > bestLong.confidence) {
        toKeep = bestShort;
        toInvalidate = longSignals;
      } else {
        const longTime = new Date(bestLong.created_at).getTime();
        const shortTime = new Date(bestShort.created_at).getTime();
        if (longTime > shortTime) {
          toKeep = bestLong;
          toInvalidate = shortSignals;
        } else {
          toKeep = bestShort;
          toInvalidate = longSignals;
        }
      }

      for (const sig of toInvalidate) {
        await db.client
          .from('quality_signals')
          .update({
            is_active: false,
            invalidated: true,
            invalidation_reason: `conflict_resolved_kept_${toKeep.direction}`,
          })
          .eq('id', sig.id);

        logger.info(
          `Conflict resolved: ${coin} | ` +
          `Kept ${toKeep.direction.toUpperCase()} (${toKeep.confidence}%), ` +
          `Invalidated ${sig.direction.toUpperCase()} (${sig.confidence}%)`
        );
        resolved++;
      }
    }
  }

  return resolved;
}

async function hasConflictingActiveSignal(
  coin: string,
  direction: 'long' | 'short'
): Promise<ExistingSignal | null> {
  const oppositeDirection = direction === 'long' ? 'short' : 'long';
  
  const { data } = await db.client
    .from('quality_signals')
    .select('*')
    .eq('coin', coin)
    .eq('direction', oppositeDirection)
    .eq('is_active', true)
    .single();

  return data as ExistingSignal | null;
}

// ============================================
// Main Signal Generation
// ============================================

export async function generateSignals(): Promise<void> {
  try {
    const deactivated = await deactivateClosedSignals();
    if (deactivated > 0) {
      logger.info(`Deactivated ${deactivated} closed signals`);
    }

    const conflictsResolved = await resolveConflictingSignals();
    if (conflictsResolved > 0) {
      logger.info(`Resolved ${conflictsResolved} conflicting signals`);
    }

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

    const { data: existingSignals } = await db.client
      .from('quality_signals')
      .select('*')
      .eq('is_active', true);

    const existingSignalMap = new Map<string, ExistingSignal>();
    if (existingSignals) {
      for (const sig of existingSignals) {
        existingSignalMap.set(`${sig.coin}-${sig.direction}`, sig as ExistingSignal);
      }
    }

    const validSignals: unknown[] = [];
    const processedKeys = new Set<string>();

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

        const rawConviction = trader.account_value > 0
          ? (pos.value_usd / trader.account_value) * 100
          : 0;
        const convictionPct = Math.min(100, rawConviction);

        // V9: Calculate unrealized P&L percentage for this position
        const unrealizedPnl = pos.unrealized_pnl || 0;
        const unrealizedPnlPct = pos.value_usd > 0 
          ? (unrealizedPnl / pos.value_usd) * 100 
          : 0;

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
          opened_at: pos.opened_at || null,
          unrealized_pnl: unrealizedPnl,
          unrealized_pnl_pct: unrealizedPnlPct,
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

      const avgConvictionPct = allTraders.reduce((sum, t) => sum + t.conviction_pct, 0) / allTraders.length;
      const maxConvictionPct = Math.max(...allTraders.map(t => t.conviction_pct));
      const tradersWithStops = allTraders.filter(t => t.has_stop_order).length;

      // V9: Calculate lead trader underwater percentage
      const leadTraderUnderwaterPct = calculateLeadTraderUnderwaterPct(allTraders);

      const currentPrice = await getCurrentPrice(coin);
      if (!currentPrice) continue;

      const signalKey = `${coin}-${direction}`;
      processedKeys.add(signalKey);
      
      const existingSignal = existingSignalMap.get(signalKey);
      const conflicting = await hasConflictingActiveSignal(coin, direction);
      
      let entryPrice: number;
      let stopLoss: number;
      let stopDistancePct: number;
      let tp1: number, tp2: number, tp3: number;
      let volatilityRank: number;
      let atrMultiple: number;

      if (existingSignal) {
        entryPrice = existingSignal.entry_price;
        stopLoss = existingSignal.stop_loss;
        tp1 = existingSignal.take_profit_1;
        tp2 = existingSignal.take_profit_2;
        tp3 = existingSignal.take_profit_3;
        stopDistancePct = Math.abs(stopLoss - entryPrice) / entryPrice * 100;
        volatilityRank = 50;
        atrMultiple = 2.0;
        
        const tpValid = direction === 'long' 
          ? (tp1 > entryPrice && tp2 > entryPrice && tp3 > entryPrice)
          : (tp1 < entryPrice && tp2 < entryPrice && tp3 < entryPrice);
          
        if (!tpValid) {
          logger.warn(`Invalid TPs detected for existing ${coin} ${direction}, recalculating...`);
          const stopData = await calculateEnhancedStopLoss(coin, direction, allTraders, entryPrice);
          const newTps = calculateTakeProfits(direction, entryPrice, stopData.stopLoss);
          stopLoss = stopData.stopLoss;
          stopDistancePct = stopData.stopDistancePct;
          tp1 = newTps.tp1;
          tp2 = newTps.tp2;
          tp3 = newTps.tp3;
        }
      } else {
        entryPrice = currentPrice;
        const stopData = await calculateEnhancedStopLoss(coin, direction, allTraders, entryPrice);
        const tps = calculateTakeProfits(direction, entryPrice, stopData.stopLoss);
        stopLoss = stopData.stopLoss;
        stopDistancePct = stopData.stopDistancePct;
        volatilityRank = stopData.volatilityRank;
        atrMultiple = stopData.atrMultiple;
        tp1 = tps.tp1;
        tp2 = tps.tp2;
        tp3 = tps.tp3;
        
        if (conflicting) {
          const newConfidence = calculateConfidence(
            eliteTraders.length, goodTraders.length, agreement, avgWinRate,
            avgProfitFactor, combinedPnl7d, avgConvictionPct, 'neutral',
            tradersWithStops, allTraders.length, leadTraderUnderwaterPct
          );
          
          if (newConfidence > conflicting.confidence) {
            await db.client
              .from('quality_signals')
              .update({
                is_active: false,
                invalidated: true,
                invalidation_reason: `replaced_by_${direction}_signal`,
              })
              .eq('id', conflicting.id);
            
            logger.info(
              `Replaced ${conflicting.direction} with ${direction} for ${coin} ` +
              `(${newConfidence}% > ${conflicting.confidence}%)`
            );
          } else {
            logger.debug(
              `Skipped ${coin} ${direction} - existing ${conflicting.direction} signal is stronger`
            );
            continue;
          }
        }
      }

      const entryPrices = allTraders.map(t => t.entry_price).filter(p => p > 0);
      const entryRangeLow = entryPrices.length > 0 ? Math.min(...entryPrices) : currentPrice * 0.99;
      const entryRangeHigh = entryPrices.length > 0 ? Math.max(...entryPrices) : currentPrice * 1.01;

      const suggestedLeverage = calculateSuggestedLeverage(allTraders, stopDistancePct);
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
        suggestedEntry: currentPrice,
        entryRangeLow,
        entryRangeHigh,
        stopLoss,
        stopDistancePct,
        volatilityAdjustedStop: stopLoss,
        atrMultiple,
        volatilityRank,
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
        leadTraderUnderwaterPct,
      };

      if (!meetsSignalRequirements(candidate)) {
        continue;
      }

      candidate.riskScore = calculateRiskScore(
        agreement,
        avgProfitFactor,
        avgWinRate,
        stopDistancePct,
        eliteTraders.length,
        volatilityRank,
        fundingData.context,
        leadTraderUnderwaterPct
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
        allTraders.length,
        leadTraderUnderwaterPct
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
        avg_entry_price: currentPrice,
        avg_leverage: avgLeverage,
        traders: allTraders,
        signal_strength: candidate.signalStrength,
        confidence: candidate.confidence,
        directional_agreement: agreement,
        opposing_traders: opposingCount,
        suggested_entry: currentPrice,
        entry_price: entryPrice,
        entry_range_low: entryRangeLow,
        entry_range_high: entryRangeHigh,
        stop_loss: stopLoss,
        stop_distance_pct: stopDistancePct,
        take_profit_1: tp1,
        take_profit_2: tp2,
        take_profit_3: tp3,
        suggested_leverage: suggestedLeverage,
        risk_score: candidate.riskScore,
        avg_conviction_pct: avgConvictionPct,
        funding_context: fundingData.context,
        current_funding_rate: fundingData.fundingRate,
        volatility_adjusted_stop: stopLoss,
        atr_multiple: atrMultiple,
        current_price: currentPrice,
        is_active: true,
        outcome: existingSignal?.outcome || 'open',
        expires_at: existingSignal?.expires_at || new Date(Date.now() + config.signals.expiryHours * 60 * 60 * 1000).toISOString(),
        // V9: Store lead trader underwater percentage for frontend
        lead_trader_underwater_pct: leadTraderUnderwaterPct,
      };

      validSignals.push(signalData);

      const isNew = !existingSignal;
      
      if (isNew) {
        const underwaterWarning = leadTraderUnderwaterPct > 5 
          ? ` | ⚠️ Lead -${leadTraderUnderwaterPct.toFixed(0)}%` 
          : '';
        
        logger.info(
          `NEW Signal: ${coin} ${direction.toUpperCase()} | ` +
          `${eliteTraders.length}E + ${goodTraders.length}G | ` +
          `Entry: $${entryPrice.toFixed(2)} | Stop: ${stopDistancePct.toFixed(1)}% | ` +
          `VolRank: ${volatilityRank} | ` +
          `${candidate.signalStrength.toUpperCase()} (${candidate.confidence}%)${underwaterWarning}`
        );
      }
    }

    // Handle existing signals that may no longer have qualifying positions
    for (const [key, existing] of existingSignalMap) {
      if (processedKeys.has(key)) continue;

      const currentPrice = await getCurrentPrice(existing.coin);
      if (!currentPrice) continue;

      const coinPositions = positionsByCoin.get(existing.coin) || [];
      const direction = existing.direction as 'long' | 'short';
      const directionPositions = coinPositions.filter(p => p.direction === direction);
      const qualityPositions = directionPositions.filter(p => {
        const t = traderMap.get(p.address);
        return t && (t.quality_tier === 'elite' || t.quality_tier === 'good');
      });

      const { keep, reason } = await shouldKeepSignalAlive(
        existing,
        qualityPositions.length,
        currentPrice
      );

      if (!keep) {
        await db.client
          .from('quality_signals')
          .update({
            is_active: false,
            invalidated: true,
            invalidation_reason: reason || 'no_longer_qualifies',
            current_price: currentPrice,
          })
          .eq('id', existing.id);

        logger.info(`Signal closed: ${existing.coin} ${existing.direction} | Reason: ${reason}`);
      } else {
        await db.client
          .from('quality_signals')
          .update({ current_price: currentPrice })
          .eq('id', existing.id);
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