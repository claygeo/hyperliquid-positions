// Signal Generator V3
// - Directional agreement filter (65%+ consensus required)
// - Actionable entry/stop/target levels
// - Enhanced confidence scoring
// - No conflicting signals

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';

const logger = createLogger('signal-generator');

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

interface SignalCandidate {
  coin: string;
  direction: 'long' | 'short';
  
  // Trader breakdown
  eliteTraders: TraderWithPosition[];
  goodTraders: TraderWithPosition[];
  opposingTraders: number;
  
  // Directional agreement
  directionalAgreement: number; // 0.0 - 1.0
  
  // Combined metrics
  combinedPnl7d: number;
  combinedPnl30d: number;
  avgWinRate: number;
  avgProfitFactor: number;
  totalPositionValue: number;
  
  // Entry/Exit levels
  suggestedEntry: number;
  entryRangeLow: number;
  entryRangeHigh: number;
  stopLoss: number;
  stopDistancePct: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  
  // Risk metrics
  avgLeverage: number;
  suggestedLeverage: number;
  riskScore: number; // 0-100, lower is safer
  
  // Confidence
  confidence: number; // 0-100
  signalStrength: 'strong' | 'medium';
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
  traders: TraderWithPosition[];
  signal_strength: string;
  confidence: number;
  directional_agreement: number;
  opposing_traders: number;
  suggested_entry: number;
  entry_range_low: number;
  entry_range_high: number;
  stop_loss: number;
  stop_distance_pct: number;
  take_profit_1: number;
  take_profit_2: number;
  take_profit_3: number;
  suggested_leverage: number;
  risk_score: number;
  is_active: boolean;
  expires_at: string;
}

// ============================================
// Core Functions
// ============================================

/**
 * Get current market price for a coin
 */
async function getCurrentPrice(coin: string): Promise<number | null> {
  try {
    const response = await fetch(config.hyperliquid.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
    });
    
    const data = await response.json() as Record<string, string>;
    return data[coin] ? parseFloat(data[coin]) : null;
  } catch (error) {
    logger.error(`Failed to get price for ${coin}`, error);
    return null;
  }
}

/**
 * Calculate directional agreement
 * Returns the percentage of traders on the dominant side
 */
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
 * Calculate stop loss from trader data
 * Uses liquidation prices and entry prices
 */
function calculateStopLoss(
  direction: 'long' | 'short',
  traders: TraderWithPosition[],
  currentPrice: number
): { stopLoss: number; stopDistancePct: number } {
  // Method 1: Use average liquidation price (safest stop)
  const liqPrices = traders
    .map(t => t.liquidation_price)
    .filter((p): p is number => p !== null && p > 0);
  
  // Method 2: Use entry prices with buffer
  const entryPrices = traders.map(t => t.entry_price).filter(p => p > 0);
  const avgEntry = entryPrices.length > 0 
    ? entryPrices.reduce((a, b) => a + b, 0) / entryPrices.length 
    : currentPrice;
  
  let stopLoss: number;
  
  if (direction === 'long') {
    // For longs, stop is below entry
    if (liqPrices.length > 0) {
      // Use highest liquidation price (closest to current price)
      const highestLiq = Math.max(...liqPrices);
      // Set stop above liquidation with 20% buffer
      stopLoss = highestLiq * 1.2;
    } else {
      // Default: 3% below entry
      stopLoss = avgEntry * (1 - config.signals.defaultStopPct);
    }
    // Ensure stop is below current price
    stopLoss = Math.min(stopLoss, currentPrice * 0.97);
  } else {
    // For shorts, stop is above entry
    if (liqPrices.length > 0) {
      // Use lowest liquidation price (closest to current price)
      const lowestLiq = Math.min(...liqPrices);
      // Set stop below liquidation with 20% buffer
      stopLoss = lowestLiq * 0.8;
    } else {
      // Default: 3% above entry
      stopLoss = avgEntry * (1 + config.signals.defaultStopPct);
    }
    // Ensure stop is above current price
    stopLoss = Math.max(stopLoss, currentPrice * 1.03);
  }
  
  const stopDistancePct = Math.abs(stopLoss - currentPrice) / currentPrice;
  
  return { stopLoss, stopDistancePct };
}

/**
 * Calculate take profit levels based on risk/reward
 */
function calculateTakeProfits(
  direction: 'long' | 'short',
  entry: number,
  stopLoss: number
): { tp1: number; tp2: number; tp3: number } {
  const riskDistance = Math.abs(entry - stopLoss);
  
  if (direction === 'long') {
    return {
      tp1: entry + riskDistance * 1,  // 1:1 R:R
      tp2: entry + riskDistance * 2,  // 2:1 R:R
      tp3: entry + riskDistance * 3,  // 3:1 R:R
    };
  } else {
    return {
      tp1: entry - riskDistance * 1,
      tp2: entry - riskDistance * 2,
      tp3: entry - riskDistance * 3,
    };
  }
}

/**
 * Calculate suggested leverage based on trader data and risk
 */
function calculateSuggestedLeverage(
  traders: TraderWithPosition[],
  stopDistancePct: number
): number {
  // Average leverage used by traders
  const avgLeverage = traders.reduce((sum, t) => sum + t.leverage, 0) / traders.length;
  
  // Calculate safe leverage based on stop distance
  // Rule: Don't risk more than 2% of account per trade
  const maxRiskPct = 0.02;
  const safeLeverage = maxRiskPct / stopDistancePct;
  
  // Use the more conservative of: avg trader leverage or safe leverage
  let suggested = Math.min(avgLeverage, safeLeverage);
  
  // Cap at config max
  suggested = Math.min(suggested, config.signals.maxSuggestedLeverage);
  
  // Round to reasonable number
  return Math.round(suggested * 2) / 2; // Round to 0.5
}

/**
 * Calculate risk score (0-100, lower is safer)
 */
function calculateRiskScore(
  directionalAgreement: number,
  avgProfitFactor: number,
  avgWinRate: number,
  stopDistancePct: number,
  eliteCount: number
): number {
  let score = 50; // Start at medium risk
  
  // Lower risk for high agreement
  if (directionalAgreement >= 0.9) score -= 15;
  else if (directionalAgreement >= 0.8) score -= 10;
  else if (directionalAgreement >= 0.7) score -= 5;
  
  // Lower risk for high profit factor
  if (avgProfitFactor >= 2.0) score -= 10;
  else if (avgProfitFactor >= 1.5) score -= 5;
  
  // Lower risk for high win rate
  if (avgWinRate >= 0.6) score -= 10;
  else if (avgWinRate >= 0.55) score -= 5;
  
  // Lower risk for more elite traders
  if (eliteCount >= 3) score -= 10;
  else if (eliteCount >= 2) score -= 5;
  
  // Higher risk for tight stops
  if (stopDistancePct < 0.02) score += 10;
  else if (stopDistancePct < 0.03) score += 5;
  
  // Clamp to 0-100
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate confidence score (0-100)
 */
function calculateConfidence(
  eliteCount: number,
  goodCount: number,
  directionalAgreement: number,
  avgWinRate: number,
  avgProfitFactor: number,
  combinedPnl7d: number
): number {
  let confidence = 0;
  
  // Trader count (up to 30 points)
  confidence += Math.min(eliteCount * 15, 30);
  confidence += Math.min(goodCount * 5, 15);
  
  // Directional agreement (up to 20 points)
  if (directionalAgreement >= 0.9) confidence += 20;
  else if (directionalAgreement >= 0.8) confidence += 15;
  else if (directionalAgreement >= 0.7) confidence += 10;
  else confidence += 5;
  
  // Win rate (up to 15 points)
  if (avgWinRate >= 0.6) confidence += 15;
  else if (avgWinRate >= 0.55) confidence += 10;
  else if (avgWinRate >= 0.5) confidence += 5;
  
  // Profit factor (up to 15 points)
  if (avgProfitFactor >= 2.0) confidence += 15;
  else if (avgProfitFactor >= 1.5) confidence += 10;
  else if (avgProfitFactor >= 1.2) confidence += 5;
  
  // Combined PnL (up to 10 points)
  if (combinedPnl7d >= 100000) confidence += 10;
  else if (combinedPnl7d >= 50000) confidence += 7;
  else if (combinedPnl7d >= 25000) confidence += 5;
  
  return Math.min(confidence, 100);
}

/**
 * Determine signal strength
 */
function determineSignalStrength(
  eliteCount: number,
  goodCount: number
): 'strong' | 'medium' {
  const { strongSignal } = config.signals;
  
  if (eliteCount >= strongSignal.minElite) return 'strong';
  if (goodCount >= strongSignal.minGood) return 'strong';
  if (eliteCount >= strongSignal.minMixed.elite && goodCount >= strongSignal.minMixed.good) return 'strong';
  
  return 'medium';
}

/**
 * Check if signal meets minimum requirements
 */
function meetsSignalRequirements(candidate: SignalCandidate): boolean {
  const { signals: cfg } = config;
  
  // Must meet directional agreement threshold
  if (candidate.directionalAgreement < cfg.minDirectionalAgreement) {
    return false;
  }
  
  // Must meet trader count requirements
  const eliteCount = candidate.eliteTraders.length;
  const goodCount = candidate.goodTraders.length;
  
  const hasEnoughElite = eliteCount >= cfg.minEliteForSignal;
  const hasEnoughGood = goodCount >= cfg.minGoodForSignal;
  const hasEnoughMixed = eliteCount >= cfg.minMixedForSignal.elite && 
                         goodCount >= cfg.minMixedForSignal.good;
  
  if (!hasEnoughElite && !hasEnoughGood && !hasEnoughMixed) {
    return false;
  }
  
  // Must meet combined PnL threshold
  if (candidate.combinedPnl7d < cfg.minCombinedPnl7d) {
    return false;
  }
  
  // Must meet average win rate threshold
  if (candidate.avgWinRate < cfg.minAvgWinRate) {
    return false;
  }
  
  return true;
}

// ============================================
// Main Signal Generation
// ============================================

export async function generateSignals(): Promise<void> {
  try {
    // Get all tracked traders with their quality metrics
    const { data: traders, error: traderError } = await db.client
      .from('trader_quality')
      .select('address, quality_tier, pnl_7d, pnl_30d, win_rate, profit_factor, account_value')
      .in('quality_tier', ['elite', 'good'])
      .eq('is_tracked', true);
    
    if (traderError || !traders || traders.length === 0) {
      logger.warn('No tracked traders found');
      return;
    }
    
    // Get all positions for tracked traders
    const addresses = traders.map(t => t.address);
    const { data: positions, error: posError } = await db.client
      .from('trader_positions')
      .select('*')
      .in('address', addresses);
    
    if (posError || !positions) {
      logger.error('Failed to get positions', posError);
      return;
    }
    
    // Create trader lookup
    const traderMap = new Map(traders.map(t => [t.address, t]));
    
    // Group positions by coin
    const positionsByCoin = new Map<string, TraderPosition[]>();
    for (const pos of positions) {
      const existing = positionsByCoin.get(pos.coin) || [];
      existing.push(pos as TraderPosition);
      positionsByCoin.set(pos.coin, existing);
    }
    
    // Analyze each coin for potential signals
    const validSignals: SignalData[] = [];
    
    for (const [coin, coinPositions] of positionsByCoin) {
      // Separate longs and shorts
      const longs = coinPositions.filter(p => p.direction === 'long');
      const shorts = coinPositions.filter(p => p.direction === 'short');
      
      // Get quality trader counts for each direction
      const longQuality = longs.filter(p => {
        const t = traderMap.get(p.address);
        return t && (t.quality_tier === 'elite' || t.quality_tier === 'good');
      });
      const shortQuality = shorts.filter(p => {
        const t = traderMap.get(p.address);
        return t && (t.quality_tier === 'elite' || t.quality_tier === 'good');
      });
      
      // Calculate directional agreement
      const { direction, agreement } = calculateDirectionalAgreement(
        longQuality.length,
        shortQuality.length
      );
      
      // Skip if not enough agreement
      if (agreement < config.signals.minDirectionalAgreement) {
        logger.debug(`${coin}: Skipping - only ${(agreement * 100).toFixed(0)}% agreement (need ${config.signals.minDirectionalAgreement * 100}%)`);
        continue;
      }
      
      // Get the dominant side's positions
      const dominantPositions = direction === 'long' ? longQuality : shortQuality;
      const opposingCount = direction === 'long' ? shortQuality.length : longQuality.length;
      
      // Separate by tier
      const eliteTraders: TraderWithPosition[] = [];
      const goodTraders: TraderWithPosition[] = [];
      
      for (const pos of dominantPositions) {
        const trader = traderMap.get(pos.address);
        if (!trader) continue;
        
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
        };
        
        if (trader.quality_tier === 'elite') {
          eliteTraders.push(traderWithPos);
        } else {
          goodTraders.push(traderWithPos);
        }
      }
      
      // Calculate combined metrics
      const allTraders = [...eliteTraders, ...goodTraders];
      const combinedPnl7d = allTraders.reduce((sum, t) => sum + t.pnl_7d, 0);
      const combinedPnl30d = allTraders.reduce((sum, t) => sum + t.pnl_30d, 0);
      const avgWinRate = allTraders.reduce((sum, t) => sum + t.win_rate, 0) / allTraders.length;
      const avgProfitFactor = allTraders.reduce((sum, t) => sum + t.profit_factor, 0) / allTraders.length;
      const totalPositionValue = allTraders.reduce((sum, t) => sum + t.position_value, 0);
      const avgLeverage = allTraders.reduce((sum, t) => sum + t.leverage, 0) / allTraders.length;
      
      // Get current price
      const currentPrice = await getCurrentPrice(coin);
      if (!currentPrice) {
        logger.warn(`${coin}: Could not get current price`);
        continue;
      }
      
      // Calculate entry range from trader entries
      const entryPrices = allTraders.map(t => t.entry_price).filter(p => p > 0);
      const suggestedEntry = currentPrice; // Use current price as entry
      const entryRangeLow = entryPrices.length > 0 ? Math.min(...entryPrices) : currentPrice * 0.99;
      const entryRangeHigh = entryPrices.length > 0 ? Math.max(...entryPrices) : currentPrice * 1.01;
      
      // Calculate stop loss
      const { stopLoss, stopDistancePct } = calculateStopLoss(direction, allTraders, currentPrice);
      
      // Calculate take profits
      const { tp1, tp2, tp3 } = calculateTakeProfits(direction, suggestedEntry, stopLoss);
      
      // Calculate suggested leverage
      const suggestedLeverage = calculateSuggestedLeverage(allTraders, stopDistancePct);
      
      // Create candidate
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
        suggestedEntry,
        entryRangeLow,
        entryRangeHigh,
        stopLoss,
        stopDistancePct,
        takeProfit1: tp1,
        takeProfit2: tp2,
        takeProfit3: tp3,
        avgLeverage,
        suggestedLeverage,
        riskScore: 0, // Will calculate below
        confidence: 0, // Will calculate below
        signalStrength: 'medium',
      };
      
      // Check if meets requirements
      if (!meetsSignalRequirements(candidate)) {
        continue;
      }
      
      // Calculate risk score
      candidate.riskScore = calculateRiskScore(
        agreement,
        avgProfitFactor,
        avgWinRate,
        stopDistancePct,
        eliteTraders.length
      );
      
      // Calculate confidence
      candidate.confidence = calculateConfidence(
        eliteTraders.length,
        goodTraders.length,
        agreement,
        avgWinRate,
        avgProfitFactor,
        combinedPnl7d
      );
      
      // Determine strength
      candidate.signalStrength = determineSignalStrength(eliteTraders.length, goodTraders.length);
      
      // Convert to SignalData
      const signalData: SignalData = {
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
        stop_loss: stopLoss,
        stop_distance_pct: stopDistancePct,
        take_profit_1: tp1,
        take_profit_2: tp2,
        take_profit_3: tp3,
        suggested_leverage: suggestedLeverage,
        risk_score: candidate.riskScore,
        is_active: true,
        expires_at: new Date(Date.now() + config.signals.expiryHours * 60 * 60 * 1000).toISOString(),
      };
      
      validSignals.push(signalData);
      
      // Log the signal
      const agreementPct = (agreement * 100).toFixed(0);
      const wrPct = (avgWinRate * 100).toFixed(0);
      logger.info(
        `Signal: ${coin} ${direction.toUpperCase()} | ` +
        `${eliteTraders.length}E + ${goodTraders.length}G | ` +
        `${agreementPct}% agree | ` +
        `+$${Math.round(combinedPnl7d).toLocaleString()} 7d PnL | ` +
        `${wrPct}% WR | ` +
        `${avgProfitFactor.toFixed(1)} PF | ` +
        `${candidate.signalStrength.toUpperCase()} (${candidate.confidence}%)`
      );
    }
    
    // Deactivate old signals for coins that no longer qualify
    const activeCoinDirections = new Set(validSignals.map(s => `${s.coin}-${s.direction}`));
    
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
              invalidation_reason: 'no_longer_qualifies'
            })
            .eq('id', existing.id);
        }
      }
    }
    
    // Upsert valid signals
    for (const signal of validSignals) {
      await db.client
        .from('quality_signals')
        .upsert(signal, {
          onConflict: 'coin,direction',
        });
    }
    
    logger.info(`Active signals: ${validSignals.length}`);
    
  } catch (error) {
    logger.error('Signal generation failed', error);
  }
}

// ============================================
// Exports
// ============================================

export async function getActiveSignals(): Promise<SignalData[]> {
  const { data, error } = await db.client
    .from('quality_signals')
    .select('*')
    .eq('is_active', true)
    .order('confidence', { ascending: false });
  
  if (error) {
    logger.error('Failed to get active signals', error);
    return [];
  }
  
  return (data || []) as SignalData[];
}

export async function getSignalForCoin(coin: string): Promise<SignalData | null> {
  const { data, error } = await db.client
    .from('quality_signals')
    .select('*')
    .eq('coin', coin)
    .eq('is_active', true)
    .single();
  
  if (error) return null;
  return data as SignalData;
}