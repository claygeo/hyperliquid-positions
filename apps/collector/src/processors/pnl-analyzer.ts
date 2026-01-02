// PnL Analyzer V5
// Enhanced with:
// - Multi-timeframe classification (7/30/60/90 days)
// - Max drawdown calculation
// - Strategy classification (momentum, mean-reversion, scalper, swing)
// - Equity curve tracking
// - Consistency scoring

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import hyperliquid from '../utils/hyperliquid-api.js';

const logger = createLogger('pnl-analyzer-v5');

// ============================================
// Types
// ============================================

export interface TraderAnalysis {
  address: string;
  account_value: number;
  
  // Multi-timeframe PnL
  pnl_7d: number;
  pnl_30d: number;
  pnl_60d: number;
  pnl_90d: number;
  
  // Multi-timeframe ROI
  roi_7d_pct: number;
  roi_30d_pct: number;
  roi_60d_pct: number;
  roi_90d_pct: number;
  
  // Core metrics
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  avg_trade_size: number;
  
  // Win/Loss details
  largest_win: number;
  largest_loss: number;
  avg_winner_pct: number;
  avg_loser_pct: number;
  win_streak_max: number;
  loss_streak_max: number;
  
  // Drawdown metrics
  max_drawdown_7d_pct: number;
  max_drawdown_30d_pct: number;
  current_drawdown_pct: number;
  peak_equity: number;
  
  // Strategy classification
  strategy_type: StrategyType;
  avg_hold_time_hours: number;
  trade_frequency_per_day: number;
  
  // Consistency
  sharpe_ratio_30d: number;
  sortino_ratio_30d: number;
  consistency_score: number;
  
  // Classification
  quality_tier: 'elite' | 'good' | 'weak';
  quality_reasons: string[];
  is_tracked: boolean;
  analyzed_at: Date;
}

type StrategyType = 'momentum' | 'mean_reversion' | 'scalper' | 'swing' | 'position' | 'unknown';

interface TradeData {
  coin: string;
  closedPnl: number;
  size: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  direction: 'long' | 'short';
  pnlPct: number;
}

interface DailyEquity {
  date: Date;
  accountValue: number;
  dailyPnl: number;
  trades: number;
  wins: number;
}

// ============================================
// Core Analysis Functions
// ============================================

/**
 * Comprehensive trader analysis with multi-timeframe metrics
 */
export async function analyzeTrader(address: string): Promise<TraderAnalysis | null> {
  try {
    // Get account state
    const state = await hyperliquid.getClearinghouseState(address);
    if (!state) {
      logger.warn(`Could not get state for ${address.slice(0, 10)}...`);
      return null;
    }

    const accountValue = parseFloat(state.marginSummary.accountValue);

    // Get fills for different timeframes
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    
    const fills = await hyperliquid.getUserFills(address, ninetyDaysAgo);
    
    if (!fills || fills.length === 0) {
      return createEmptyAnalysis(address, accountValue);
    }

    // Process fills into trades
    const allTrades = processTradesFromFills(fills);
    
    if (allTrades.length === 0) {
      return createEmptyAnalysis(address, accountValue);
    }

    // Filter by timeframes
    const trades7d = allTrades.filter(t => t.exitTime >= sevenDaysAgo);
    const trades30d = allTrades.filter(t => t.exitTime >= thirtyDaysAgo);
    const trades60d = allTrades.filter(t => t.exitTime >= sixtyDaysAgo);
    const trades90d = allTrades;

    // Calculate PnL for each timeframe
    const pnl7d = sumPnl(trades7d);
    const pnl30d = sumPnl(trades30d);
    const pnl60d = sumPnl(trades60d);
    const pnl90d = sumPnl(trades90d);

    // Calculate ROI
    const roi7dPct = calculateRoi(pnl7d, accountValue);
    const roi30dPct = calculateRoi(pnl30d, accountValue);
    const roi60dPct = calculateRoi(pnl60d, accountValue);
    const roi90dPct = calculateRoi(pnl90d, accountValue);

    // Win/Loss analysis
    const wins30d = trades30d.filter(t => t.closedPnl > 0);
    const losses30d = trades30d.filter(t => t.closedPnl < 0);
    
    const winRate = trades30d.length > 0 ? wins30d.length / trades30d.length : 0;
    
    const grossProfit = wins30d.reduce((sum, t) => sum + t.closedPnl, 0);
    const grossLoss = Math.abs(losses30d.reduce((sum, t) => sum + t.closedPnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 10 : 0);

    // Win/Loss details
    const avgTradeSize = trades30d.length > 0 
      ? trades30d.reduce((sum, t) => sum + t.size, 0) / trades30d.length 
      : 0;
    const largestWin = wins30d.length > 0 ? Math.max(...wins30d.map(t => t.closedPnl)) : 0;
    const largestLoss = losses30d.length > 0 ? Math.min(...losses30d.map(t => t.closedPnl)) : 0;
    
    const avgWinnerPct = wins30d.length > 0 
      ? wins30d.reduce((sum, t) => sum + t.pnlPct, 0) / wins30d.length 
      : 0;
    const avgLoserPct = losses30d.length > 0 
      ? losses30d.reduce((sum, t) => sum + t.pnlPct, 0) / losses30d.length 
      : 0;

    // Streaks
    const { maxWinStreak, maxLossStreak } = calculateStreaks(trades30d);

    // Hold time and frequency
    const holdTimes = trades30d
      .filter(t => t.exitTime > t.entryTime)
      .map(t => (t.exitTime - t.entryTime) / (1000 * 60 * 60));
    const avgHoldTimeHours = holdTimes.length > 0 
      ? holdTimes.reduce((sum, h) => sum + h, 0) / holdTimes.length 
      : 0;
    
    const tradingDays30d = 30;
    const tradeFrequencyPerDay = trades30d.length / tradingDays30d;

    // Drawdown calculation
    const dailyEquity = buildDailyEquityCurve(allTrades, accountValue);
    const maxDrawdown7d = calculateMaxDrawdown(dailyEquity, 7);
    const maxDrawdown30d = calculateMaxDrawdown(dailyEquity, 30);
    const currentDrawdown = calculateCurrentDrawdown(dailyEquity);
    const peakEquity = dailyEquity.length > 0 
      ? Math.max(...dailyEquity.map(d => d.accountValue))
      : accountValue;

    // Strategy classification
    const strategyType = classifyStrategy(trades30d, avgHoldTimeHours, tradeFrequencyPerDay);

    // Consistency metrics
    const { sharpeRatio, sortinoRatio } = calculateRiskAdjustedReturns(dailyEquity);
    const consistencyScore = calculateConsistencyScore({
      winRate,
      profitFactor,
      maxDrawdown30d,
      sharpeRatio,
      tradeCount: trades30d.length,
    });

    // Determine quality tier
    const { tier, reasons } = determineQualityTierV5({
      accountValue,
      pnl7d, pnl30d, pnl60d, pnl90d,
      roi7dPct, roi30dPct, roi60dPct, roi90dPct,
      winRate,
      profitFactor,
      totalTrades: trades30d.length,
      maxDrawdown30d,
      consistencyScore,
    });

    const analysis: TraderAnalysis = {
      address: address.toLowerCase(),
      account_value: accountValue,
      
      pnl_7d: pnl7d,
      pnl_30d: pnl30d,
      pnl_60d: pnl60d,
      pnl_90d: pnl90d,
      
      roi_7d_pct: roi7dPct,
      roi_30d_pct: roi30dPct,
      roi_60d_pct: roi60dPct,
      roi_90d_pct: roi90dPct,
      
      win_rate: winRate,
      profit_factor: Math.min(profitFactor, 100),
      total_trades: trades30d.length,
      avg_trade_size: avgTradeSize,
      
      largest_win: largestWin,
      largest_loss: largestLoss,
      avg_winner_pct: avgWinnerPct,
      avg_loser_pct: avgLoserPct,
      win_streak_max: maxWinStreak,
      loss_streak_max: maxLossStreak,
      
      max_drawdown_7d_pct: maxDrawdown7d,
      max_drawdown_30d_pct: maxDrawdown30d,
      current_drawdown_pct: currentDrawdown,
      peak_equity: peakEquity,
      
      strategy_type: strategyType,
      avg_hold_time_hours: avgHoldTimeHours,
      trade_frequency_per_day: tradeFrequencyPerDay,
      
      sharpe_ratio_30d: sharpeRatio,
      sortino_ratio_30d: sortinoRatio,
      consistency_score: consistencyScore,
      
      quality_tier: tier,
      quality_reasons: reasons,
      is_tracked: tier === 'elite' || tier === 'good',
      analyzed_at: new Date(),
    };

    // Log summary
    const strategyEmoji = getStrategyEmoji(strategyType);
    logger.info(
      `Analyzed ${address.slice(0, 10)}... | ` +
      `${tier.toUpperCase()} | ` +
      `ROI: ${roi7dPct.toFixed(1)}% | ` +
      `PnL: $${pnl7d.toFixed(0)} | ` +
      `WR: ${(winRate * 100).toFixed(0)}% | ` +
      `PF: ${profitFactor.toFixed(2)} | ` +
      `DD: ${maxDrawdown30d.toFixed(1)}% | ` +
      `${strategyEmoji} ${strategyType} | ` +
      `${trades30d.length} trades`
    );

    return analysis;

  } catch (error) {
    logger.error(`Failed to analyze ${address}`, error);
    return null;
  }
}

// ============================================
// Helper Functions
// ============================================

function sumPnl(trades: TradeData[]): number {
  return trades.reduce((sum, t) => sum + t.closedPnl, 0);
}

function calculateRoi(pnl: number, accountValue: number): number {
  if (accountValue < 100) return 0;
  const roi = (pnl / accountValue) * 100;
  return Math.max(-100, Math.min(1000, roi));
}

function calculateStreaks(trades: TradeData[]): { maxWinStreak: number; maxLossStreak: number } {
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;

  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  
  for (const trade of sorted) {
    if (trade.closedPnl > 0) {
      currentWinStreak++;
      currentLossStreak = 0;
      maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
    } else if (trade.closedPnl < 0) {
      currentLossStreak++;
      currentWinStreak = 0;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    }
  }

  return { maxWinStreak, maxLossStreak };
}

function buildDailyEquityCurve(trades: TradeData[], currentAccountValue: number): DailyEquity[] {
  const dailyMap = new Map<string, DailyEquity>();
  
  // Sort trades by exit time
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  
  // Group by day
  for (const trade of sorted) {
    const date = new Date(trade.exitTime);
    const dateKey = date.toISOString().split('T')[0];
    
    const existing = dailyMap.get(dateKey) || {
      date,
      accountValue: currentAccountValue,
      dailyPnl: 0,
      trades: 0,
      wins: 0,
    };
    
    existing.dailyPnl += trade.closedPnl;
    existing.trades++;
    if (trade.closedPnl > 0) existing.wins++;
    
    dailyMap.set(dateKey, existing);
  }

  // Build equity curve (work backwards from current)
  const days = Array.from(dailyMap.values()).sort((a, b) => 
    b.date.getTime() - a.date.getTime()
  );
  
  let runningEquity = currentAccountValue;
  for (const day of days) {
    day.accountValue = runningEquity;
    runningEquity -= day.dailyPnl;
  }

  return days.reverse();
}

function calculateMaxDrawdown(equity: DailyEquity[], days: number): number {
  if (equity.length === 0) return 0;
  
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const filtered = equity.filter(d => d.date >= cutoffDate);
  
  if (filtered.length === 0) return 0;
  
  let peak = 0;
  let maxDrawdown = 0;
  
  for (const day of filtered) {
    if (day.accountValue > peak) {
      peak = day.accountValue;
    }
    
    if (peak > 0) {
      const drawdown = (peak - day.accountValue) / peak * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
  }
  
  return maxDrawdown;
}

function calculateCurrentDrawdown(equity: DailyEquity[]): number {
  if (equity.length === 0) return 0;
  
  const peak = Math.max(...equity.map(d => d.accountValue));
  const current = equity[equity.length - 1]?.accountValue || 0;
  
  if (peak <= 0) return 0;
  return (peak - current) / peak * 100;
}

function calculateRiskAdjustedReturns(equity: DailyEquity[]): {
  sharpeRatio: number;
  sortinoRatio: number;
} {
  if (equity.length < 7) {
    return { sharpeRatio: 0, sortinoRatio: 0 };
  }

  // Calculate daily returns
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1].accountValue > 0) {
      const dailyReturn = (equity[i].accountValue - equity[i - 1].accountValue) / equity[i - 1].accountValue;
      returns.push(dailyReturn);
    }
  }

  if (returns.length < 5) {
    return { sharpeRatio: 0, sortinoRatio: 0 };
  }

  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const stdDev = Math.sqrt(
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
  );

  // Downside deviation (only negative returns)
  const negReturns = returns.filter(r => r < 0);
  const downsideDev = negReturns.length > 0
    ? Math.sqrt(negReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negReturns.length)
    : 0.001;

  // Annualize (assuming 365 trading days for crypto)
  const annualFactor = Math.sqrt(365);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * annualFactor : 0;
  const sortinoRatio = downsideDev > 0 ? (avgReturn / downsideDev) * annualFactor : 0;

  return {
    sharpeRatio: Math.max(-10, Math.min(10, sharpeRatio)),
    sortinoRatio: Math.max(-10, Math.min(10, sortinoRatio)),
  };
}

function calculateConsistencyScore(metrics: {
  winRate: number;
  profitFactor: number;
  maxDrawdown30d: number;
  sharpeRatio: number;
  tradeCount: number;
}): number {
  let score = 0;

  // Win rate contribution (0-25)
  if (metrics.winRate >= 0.6) score += 25;
  else if (metrics.winRate >= 0.5) score += 20;
  else if (metrics.winRate >= 0.45) score += 15;
  else if (metrics.winRate >= 0.4) score += 10;

  // Profit factor contribution (0-25)
  if (metrics.profitFactor >= 3) score += 25;
  else if (metrics.profitFactor >= 2) score += 20;
  else if (metrics.profitFactor >= 1.5) score += 15;
  else if (metrics.profitFactor >= 1.2) score += 10;

  // Drawdown contribution (0-25) - lower is better
  if (metrics.maxDrawdown30d <= 5) score += 25;
  else if (metrics.maxDrawdown30d <= 10) score += 20;
  else if (metrics.maxDrawdown30d <= 15) score += 15;
  else if (metrics.maxDrawdown30d <= 25) score += 10;

  // Sharpe ratio contribution (0-25)
  if (metrics.sharpeRatio >= 3) score += 25;
  else if (metrics.sharpeRatio >= 2) score += 20;
  else if (metrics.sharpeRatio >= 1) score += 15;
  else if (metrics.sharpeRatio >= 0.5) score += 10;

  // Trade count bonus/penalty
  if (metrics.tradeCount < 10) score -= 10;
  else if (metrics.tradeCount >= 50) score += 5;

  return Math.max(0, Math.min(100, score));
}

// ============================================
// Strategy Classification
// ============================================

function classifyStrategy(
  trades: TradeData[],
  avgHoldTimeHours: number,
  tradeFrequencyPerDay: number
): StrategyType {
  if (trades.length < 5) return 'unknown';

  // Scalper: Very short holds, high frequency
  if (avgHoldTimeHours < 1 && tradeFrequencyPerDay >= 5) {
    return 'scalper';
  }

  // Position trader: Very long holds
  if (avgHoldTimeHours >= 168) { // 1 week+
    return 'position';
  }

  // Swing trader: Multi-day holds
  if (avgHoldTimeHours >= 24 && avgHoldTimeHours < 168) {
    return 'swing';
  }

  // Analyze entry patterns for momentum vs mean-reversion
  const { momentumScore, meanReversionScore } = analyzeEntryPatterns(trades);

  if (momentumScore > meanReversionScore + 10) {
    return 'momentum';
  } else if (meanReversionScore > momentumScore + 10) {
    return 'mean_reversion';
  }

  // Default based on hold time
  if (avgHoldTimeHours < 4) {
    return 'scalper';
  } else if (avgHoldTimeHours < 24) {
    return 'momentum'; // Day trader, assume momentum
  }

  return 'swing';
}

function analyzeEntryPatterns(trades: TradeData[]): {
  momentumScore: number;
  meanReversionScore: number;
} {
  let momentumScore = 0;
  let meanReversionScore = 0;

  for (const trade of trades) {
    // Momentum: Buy high, sell higher (or short low, cover lower)
    // Mean reversion: Buy low, sell high (or short high, cover low)
    
    if (trade.direction === 'long') {
      // If profitable long with higher exit than entry = momentum working
      if (trade.closedPnl > 0) {
        momentumScore += 1;
      } else {
        // Unprofitable long might be mean reversion attempt that failed
        meanReversionScore += 0.5;
      }
    } else {
      // Short
      if (trade.closedPnl > 0) {
        momentumScore += 1;
      } else {
        meanReversionScore += 0.5;
      }
    }
  }

  // Normalize by trade count
  const total = trades.length;
  return {
    momentumScore: (momentumScore / total) * 100,
    meanReversionScore: (meanReversionScore / total) * 100,
  };
}

function getStrategyEmoji(strategy: StrategyType): string {
  const emojis: Record<StrategyType, string> = {
    momentum: '🚀',
    mean_reversion: '🔄',
    scalper: '⚡',
    swing: '🌊',
    position: '🏔️',
    unknown: '❓',
  };
  return emojis[strategy];
}

// ============================================
// Quality Tier Classification V5
// ============================================

function determineQualityTierV5(metrics: {
  accountValue: number;
  pnl7d: number;
  pnl30d: number;
  pnl60d: number;
  pnl90d: number;
  roi7dPct: number;
  roi30dPct: number;
  roi60dPct: number;
  roi90dPct: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  maxDrawdown30d: number;
  consistencyScore: number;
}): { tier: 'elite' | 'good' | 'weak'; reasons: string[] } {
  const { elite, good } = config.quality;
  const reasons: string[] = [];

  // ============================================
  // ELITE TIER
  // Must show consistent performance across timeframes
  // ============================================
  const eliteChecks = {
    // Performance: ROI OR absolute PnL
    passes7dPerformance: metrics.roi7dPct >= elite.minRoi7dPct || metrics.pnl7d >= elite.minPnl7dAlt,
    // Multi-timeframe consistency: 30d should also be positive
    passes30dPositive: metrics.pnl30d > 0,
    // Risk control: Drawdown under control
    passesDrawdown: metrics.maxDrawdown30d <= 25,
    // Core metrics
    passesWinRate: metrics.winRate >= elite.minWinRate,
    passesProfitFactor: metrics.profitFactor >= elite.minProfitFactor,
    passesTrades: metrics.totalTrades >= elite.minTrades,
    passesAccountValue: metrics.accountValue >= elite.minAccountValue,
    // Consistency bonus (not required but helps)
    hasGoodConsistency: metrics.consistencyScore >= 50,
  };

  const eliteCore = eliteChecks.passes7dPerformance && 
                    eliteChecks.passesWinRate && 
                    eliteChecks.passesProfitFactor && 
                    eliteChecks.passesTrades && 
                    eliteChecks.passesAccountValue;

  const eliteBonus = eliteChecks.passes30dPositive && 
                     eliteChecks.passesDrawdown && 
                     eliteChecks.hasGoodConsistency;

  if (eliteCore && (eliteBonus || metrics.roi7dPct >= elite.minRoi7dPct * 2)) {
    if (metrics.roi7dPct >= elite.minRoi7dPct) {
      reasons.push(`ROI ${metrics.roi7dPct.toFixed(1)}% >= ${elite.minRoi7dPct}%`);
    }
    if (metrics.pnl7d >= elite.minPnl7dAlt) {
      reasons.push(`PnL $${metrics.pnl7d.toFixed(0)} >= $${elite.minPnl7dAlt}`);
    }
    reasons.push(`WR ${(metrics.winRate * 100).toFixed(0)}%`);
    reasons.push(`PF ${metrics.profitFactor.toFixed(2)}`);
    reasons.push(`DD ${metrics.maxDrawdown30d.toFixed(1)}%`);
    reasons.push(`Consistency ${metrics.consistencyScore.toFixed(0)}`);
    
    return { tier: 'elite', reasons };
  }

  // ============================================
  // GOOD TIER
  // ============================================
  const goodChecks = {
    passes7dPerformance: metrics.roi7dPct >= good.minRoi7dPct || metrics.pnl7d >= good.minPnl7dAlt,
    passesDrawdown: metrics.maxDrawdown30d <= 35,
    passesWinRate: metrics.winRate >= good.minWinRate,
    passesProfitFactor: metrics.profitFactor >= good.minProfitFactor,
    passesTrades: metrics.totalTrades >= good.minTrades,
    passesAccountValue: metrics.accountValue >= good.minAccountValue,
  };

  if (Object.values(goodChecks).every(v => v)) {
    if (metrics.roi7dPct >= good.minRoi7dPct) {
      reasons.push(`ROI ${metrics.roi7dPct.toFixed(1)}% >= ${good.minRoi7dPct}%`);
    }
    if (metrics.pnl7d >= good.minPnl7dAlt) {
      reasons.push(`PnL $${metrics.pnl7d.toFixed(0)} >= $${good.minPnl7dAlt}`);
    }
    reasons.push(`WR ${(metrics.winRate * 100).toFixed(0)}%`);
    reasons.push(`PF ${metrics.profitFactor.toFixed(2)}`);
    reasons.push(`DD ${metrics.maxDrawdown30d.toFixed(1)}%`);
    
    return { tier: 'good', reasons };
  }

  // ============================================
  // WEAK TIER - explain why
  // ============================================
  if (!goodChecks.passes7dPerformance) {
    reasons.push(`ROI ${metrics.roi7dPct.toFixed(1)}% < ${good.minRoi7dPct}% AND PnL $${metrics.pnl7d.toFixed(0)} < $${good.minPnl7dAlt}`);
  }
  if (!goodChecks.passesWinRate) {
    reasons.push(`WR ${(metrics.winRate * 100).toFixed(0)}% < ${good.minWinRate * 100}%`);
  }
  if (!goodChecks.passesProfitFactor) {
    reasons.push(`PF ${metrics.profitFactor.toFixed(2)} < ${good.minProfitFactor}`);
  }
  if (!goodChecks.passesDrawdown) {
    reasons.push(`DD ${metrics.maxDrawdown30d.toFixed(1)}% > 35%`);
  }
  if (!goodChecks.passesTrades) {
    reasons.push(`${metrics.totalTrades} trades < ${good.minTrades}`);
  }

  return { tier: 'weak', reasons };
}

// ============================================
// Trade Processing
// ============================================

function processTradesFromFills(fills: any[]): TradeData[] {
  const trades: TradeData[] = [];
  
  for (const fill of fills) {
    const closedPnl = parseFloat(fill.closedPnl || '0');
    
    // Only count as a trade if there's realized PnL
    if (closedPnl !== 0) {
      const price = parseFloat(fill.px);
      const size = Math.abs(parseFloat(fill.sz)) * price;
      const direction = fill.dir?.includes('Long') ? 'long' : 'short';
      
      // Estimate entry price from PnL
      const sizeInAsset = Math.abs(parseFloat(fill.sz));
      const pnlPct = sizeInAsset > 0 ? (closedPnl / size) * 100 : 0;
      
      trades.push({
        coin: fill.coin,
        closedPnl,
        size,
        entryTime: fill.time - (60 * 60 * 1000), // Estimate entry
        exitTime: fill.time,
        entryPrice: price, // Approximate
        exitPrice: price,
        direction,
        pnlPct,
      });
    }
  }

  return trades;
}

function createEmptyAnalysis(address: string, accountValue: number): TraderAnalysis {
  return {
    address: address.toLowerCase(),
    account_value: accountValue,
    pnl_7d: 0, pnl_30d: 0, pnl_60d: 0, pnl_90d: 0,
    roi_7d_pct: 0, roi_30d_pct: 0, roi_60d_pct: 0, roi_90d_pct: 0,
    win_rate: 0,
    profit_factor: 0,
    total_trades: 0,
    avg_trade_size: 0,
    largest_win: 0,
    largest_loss: 0,
    avg_winner_pct: 0,
    avg_loser_pct: 0,
    win_streak_max: 0,
    loss_streak_max: 0,
    max_drawdown_7d_pct: 0,
    max_drawdown_30d_pct: 0,
    current_drawdown_pct: 0,
    peak_equity: accountValue,
    strategy_type: 'unknown',
    avg_hold_time_hours: 0,
    trade_frequency_per_day: 0,
    sharpe_ratio_30d: 0,
    sortino_ratio_30d: 0,
    consistency_score: 0,
    quality_tier: 'weak',
    quality_reasons: ['No trades in last 90 days'],
    is_tracked: false,
    analyzed_at: new Date(),
  };
}

// ============================================
// Database Operations
// ============================================

export async function saveTraderAnalysis(analysis: TraderAnalysis): Promise<void> {
  try {
    const { error } = await db.client.from('trader_quality').upsert({
      address: analysis.address,
      account_value: analysis.account_value,
      
      pnl_7d: analysis.pnl_7d,
      pnl_30d: analysis.pnl_30d,
      pnl_60d: analysis.pnl_60d,
      pnl_90d: analysis.pnl_90d,
      
      roi_7d_pct: analysis.roi_7d_pct,
      roi_30d_pct: analysis.roi_30d_pct,
      roi_60d_pct: analysis.roi_60d_pct,
      roi_90d_pct: analysis.roi_90d_pct,
      
      win_rate: analysis.win_rate,
      profit_factor: analysis.profit_factor,
      total_trades: analysis.total_trades,
      avg_trade_size: analysis.avg_trade_size,
      
      largest_win: analysis.largest_win,
      largest_loss: analysis.largest_loss,
      avg_winner_pct: analysis.avg_winner_pct,
      avg_loser_pct: analysis.avg_loser_pct,
      win_streak_max: analysis.win_streak_max,
      loss_streak_max: analysis.loss_streak_max,
      
      max_drawdown_7d_pct: analysis.max_drawdown_7d_pct,
      max_drawdown_30d_pct: analysis.max_drawdown_30d_pct,
      current_drawdown_pct: analysis.current_drawdown_pct,
      peak_equity: analysis.peak_equity,
      
      strategy_type: analysis.strategy_type,
      avg_hold_time_hours: analysis.avg_hold_time_hours,
      trade_frequency_per_day: analysis.trade_frequency_per_day,
      
      sharpe_ratio_30d: analysis.sharpe_ratio_30d,
      sortino_ratio_30d: analysis.sortino_ratio_30d,
      consistency_score: analysis.consistency_score,
      
      quality_tier: analysis.quality_tier,
      quality_reasons: analysis.quality_reasons,
      is_tracked: analysis.is_tracked,
      analyzed_at: analysis.analyzed_at.toISOString(),
    }, { onConflict: 'address' });

    if (error) {
      logger.error(`Failed to save analysis for ${analysis.address}`, error);
    }

    // Also save equity snapshot
    await saveEquitySnapshot(analysis);

  } catch (error) {
    logger.error(`Failed to save analysis for ${analysis.address}`, error);
  }
}

async function saveEquitySnapshot(analysis: TraderAnalysis): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    await db.client.from('trader_equity_history').upsert({
      address: analysis.address,
      snapshot_date: today,
      account_value: analysis.account_value,
      peak_value: analysis.peak_equity,
      drawdown_pct: analysis.current_drawdown_pct,
      daily_pnl: analysis.pnl_7d / 7, // Approximate daily
      daily_roi_pct: analysis.roi_7d_pct / 7,
      trades_count: Math.round(analysis.trade_frequency_per_day),
    }, { onConflict: 'address,snapshot_date' });
  } catch (error) {
    // Ignore - table might not exist yet
  }
}

export async function getQualityStats(): Promise<{
  elite: number;
  good: number;
  weak: number;
  tracked: number;
}> {
  const { data, error } = await db.client
    .from('trader_quality')
    .select('quality_tier, is_tracked');

  if (error || !data) {
    return { elite: 0, good: 0, weak: 0, tracked: 0 };
  }

  return {
    elite: data.filter(t => t.quality_tier === 'elite').length,
    good: data.filter(t => t.quality_tier === 'good').length,
    weak: data.filter(t => t.quality_tier === 'weak').length,
    tracked: data.filter(t => t.is_tracked).length,
  };
}

export async function getTradersByTier(tier: 'elite' | 'good' | 'weak'): Promise<TraderAnalysis[]> {
  const { data, error } = await db.client
    .from('trader_quality')
    .select('*')
    .eq('quality_tier', tier)
    .order('roi_7d_pct', { ascending: false });

  return (error || !data) ? [] : data as TraderAnalysis[];
}

export async function getTrackedTraders(): Promise<TraderAnalysis[]> {
  const { data, error } = await db.client
    .from('trader_quality')
    .select('*')
    .eq('is_tracked', true)
    .order('quality_tier', { ascending: true })
    .order('roi_7d_pct', { ascending: false });

  return (error || !data) ? [] : data as TraderAnalysis[];
}

export async function getTradersByStrategy(strategy: StrategyType): Promise<TraderAnalysis[]> {
  const { data, error } = await db.client
    .from('trader_quality')
    .select('*')
    .eq('strategy_type', strategy)
    .eq('is_tracked', true)
    .order('roi_7d_pct', { ascending: false });

  return (error || !data) ? [] : data as TraderAnalysis[];
}

export async function analyzeTradersBatch(addresses: string[]): Promise<TraderAnalysis[]> {
  const results: TraderAnalysis[] = [];
  
  logger.info(`Analyzing ${addresses.length} traders...`);

  for (let i = 0; i < addresses.length; i += config.analysis.batchSize) {
    const batch = addresses.slice(i, i + config.analysis.batchSize);
    
    for (const address of batch) {
      const analysis = await analyzeTrader(address);
      if (analysis) {
        await saveTraderAnalysis(analysis);
        results.push(analysis);
      }
      
      await new Promise(resolve => setTimeout(resolve, config.rateLimit.delayBetweenRequests));
    }

    if (i + config.analysis.batchSize < addresses.length) {
      await new Promise(resolve => setTimeout(resolve, config.analysis.batchDelayMs));
    }
  }

  const elite = results.filter(r => r.quality_tier === 'elite').length;
  const good = results.filter(r => r.quality_tier === 'good').length;
  
  logger.info(`Analysis complete: ${elite} elite, ${good} good, ${results.length - elite - good} weak`);

  return results;
}

export default {
  analyzeTrader,
  saveTraderAnalysis,
  getQualityStats,
  getTradersByTier,
  getTrackedTraders,
  getTradersByStrategy,
  analyzeTradersBatch,
};