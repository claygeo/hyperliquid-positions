// PnL Analyzer V6
// 
// CRITICAL FIXES FROM V5:
// ========================
// 1. STRICT TIME FILTERING: API ignores startTime param, we filter client-side
// 2. EQUITY-BASED P&L: Calculate P&L as account_value change (matches Hyperdash)
// 3. HISTORICAL SNAPSHOTS: Store daily equity for accurate lookback calculations
// 4. CLEAR DATA PROVENANCE: Track whether P&L came from equity or realized sum
//
// The old code was showing $70K "7d P&L" when real equity change was $4K
// because it summed ALL closedPnl from fills going back months.

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import hyperliquid from '../utils/hyperliquid-api.js';

const logger = createLogger('pnl-analyzer-v6');

// ============================================
// Types
// ============================================

export interface TraderAnalysis {
  address: string;
  account_value: number;
  
  // PRIMARY: Equity-based P&L (matches Hyperdash)
  // This is what users expect when they see "7d P&L"
  pnl_7d: number;
  pnl_30d: number;
  pnl_60d: number;
  pnl_90d: number;
  
  // ROI percentages
  roi_7d_pct: number;
  roi_30d_pct: number;
  roi_60d_pct: number;
  roi_90d_pct: number;
  
  // SECONDARY: Realized P&L from closed trades (for reference)
  // Useful to see trading activity, but NOT what users compare to Hyperdash
  realized_pnl_7d: number;
  realized_pnl_30d: number;
  
  // Trading metrics (from properly time-filtered fills)
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  avg_trade_size: number;
  
  largest_win: number;
  largest_loss: number;
  avg_winner_pct: number;
  avg_loser_pct: number;
  win_streak_max: number;
  loss_streak_max: number;
  
  // Drawdown
  max_drawdown_7d_pct: number;
  max_drawdown_30d_pct: number;
  current_drawdown_pct: number;
  peak_equity: number;
  
  // Strategy
  strategy_type: StrategyType;
  avg_hold_time_hours: number;
  trade_frequency_per_day: number;
  
  // Risk metrics
  sharpe_ratio_30d: number;
  sortino_ratio_30d: number;
  consistency_score: number;
  
  // Classification
  quality_tier: 'elite' | 'good' | 'weak';
  quality_reasons: string[];
  is_tracked: boolean;
  analyzed_at: Date;
  
  // Data quality indicators
  has_equity_history: boolean;
  equity_history_days: number;
  pnl_calculation_method: 'equity_change' | 'realized_sum_filtered';
}

type StrategyType = 'momentum' | 'mean_reversion' | 'scalper' | 'swing' | 'position' | 'unknown';

interface Fill {
  coin: string;
  px: string;
  sz: string;
  side: string;
  time: number;
  dir: string;
  closedPnl: string;
  hash: string;
  fee: string;
}

interface TradeData {
  coin: string;
  closedPnl: number;
  size: number;
  exitTime: number;
  direction: 'long' | 'short';
  pnlPct: number;
}

interface EquitySnapshot {
  date: string;
  account_value: number;
}

// ============================================
// Main Analysis Function
// ============================================

export async function analyzeTrader(address: string): Promise<TraderAnalysis | null> {
  try {
    const addrLower = address.toLowerCase();
    
    // ============================================
    // Step 1: Get current account state
    // ============================================
    const state = await hyperliquid.getClearinghouseState(address);
    if (!state) {
      logger.warn(`Could not get state for ${addrLower.slice(0, 10)}...`);
      return null;
    }

    const accountValue = parseFloat(state.marginSummary.accountValue);
    // Note: totalUnrealizedPnl may not exist on all API responses, access safely
    const marginSummary = state.marginSummary as Record<string, string>;
    const unrealizedPnl = parseFloat(marginSummary.totalUnrealizedPnl || '0');

    // Save today's equity snapshot (builds history over time)
    await saveEquitySnapshot(addrLower, accountValue);

    // ============================================
    // Step 2: Get fills from API
    // NOTE: API returns last 2000 fills, IGNORES startTime
    // ============================================
    const allFills = await hyperliquid.getUserFills(address, 0);
    
    if (!allFills || allFills.length === 0) {
      return createEmptyAnalysis(addrLower, accountValue);
    }

    // ============================================
    // Step 3: CRITICAL - Filter fills by time CLIENT-SIDE
    // This is the bug fix - API does NOT filter by time
    // ============================================
    const now = Date.now();
    const timeframes = {
      '7d': now - 7 * 24 * 60 * 60 * 1000,
      '30d': now - 30 * 24 * 60 * 60 * 1000,
      '60d': now - 60 * 24 * 60 * 60 * 1000,
      '90d': now - 90 * 24 * 60 * 60 * 1000,
    };

    // STRICT time filtering - only fills within the timeframe
    const fills7d = allFills.filter((f: Fill) => f.time >= timeframes['7d']);
    const fills30d = allFills.filter((f: Fill) => f.time >= timeframes['30d']);
    const fills60d = allFills.filter((f: Fill) => f.time >= timeframes['60d']);
    const fills90d = allFills.filter((f: Fill) => f.time >= timeframes['90d']);

    // Log for debugging
    logger.debug(
      `${addrLower.slice(0, 10)}... fills: ` +
      `total=${allFills.length}, 7d=${fills7d.length}, 30d=${fills30d.length}`
    );

    // ============================================
    // Step 4: Get historical equity snapshots
    // ============================================
    const equityHistory = await getEquitySnapshots(addrLower, 90);
    const hasEquityHistory = equityHistory.length >= 2;
    const historyDays = equityHistory.length;

    // ============================================
    // Step 5: Calculate P&L using best available method
    // ============================================
    let pnl7d: number, pnl30d: number, pnl60d: number, pnl90d: number;
    let calculationMethod: 'equity_change' | 'realized_sum_filtered';

    // Calculate realized P&L from properly filtered fills
    const realizedPnl7d = sumRealizedPnl(fills7d);
    const realizedPnl30d = sumRealizedPnl(fills30d);
    const realizedPnl60d = sumRealizedPnl(fills60d);
    const realizedPnl90d = sumRealizedPnl(fills90d);

    if (hasEquityHistory) {
      // PREFERRED: Use equity snapshots for P&L calculation
      // This matches what Hyperdash and other tools show
      calculationMethod = 'equity_change';
      
      pnl7d = calculateEquityChange(equityHistory, accountValue, 7);
      pnl30d = calculateEquityChange(equityHistory, accountValue, 30);
      pnl60d = calculateEquityChange(equityHistory, accountValue, 60);
      pnl90d = calculateEquityChange(equityHistory, accountValue, 90);
      
      // If we don't have enough history for a timeframe, fall back to realized
      if (historyDays < 7) pnl7d = realizedPnl7d;
      if (historyDays < 30) pnl30d = realizedPnl30d;
      if (historyDays < 60) pnl60d = realizedPnl60d;
      if (historyDays < 90) pnl90d = realizedPnl90d;
    } else {
      // FALLBACK: Use realized P&L from properly filtered fills
      // Note: This may differ from Hyperdash until we build history
      calculationMethod = 'realized_sum_filtered';
      
      pnl7d = realizedPnl7d;
      pnl30d = realizedPnl30d;
      pnl60d = realizedPnl60d;
      pnl90d = realizedPnl90d;
      
      if (accountValue > 10000 && fills7d.length > 0) {
        logger.info(
          `⚠️ ${addrLower.slice(0, 10)}... using filtered realized P&L ` +
          `(no equity history yet). Building snapshots...`
        );
      }
    }

    // ============================================
    // Step 6: Calculate ROI
    // Base equity = what they had before the P&L
    // ============================================
    const roi7dPct = calculateRoi(pnl7d, accountValue - pnl7d);
    const roi30dPct = calculateRoi(pnl30d, accountValue - pnl30d);
    const roi60dPct = calculateRoi(pnl60d, accountValue - pnl60d);
    const roi90dPct = calculateRoi(pnl90d, accountValue - pnl90d);

    // ============================================
    // Step 7: Process trades for win rate, etc.
    // Using 30d window for classification metrics
    // ============================================
    const trades30d = processTradesFromFills(fills30d);
    
    const wins = trades30d.filter(t => t.closedPnl > 0);
    const losses = trades30d.filter(t => t.closedPnl < 0);
    
    const winRate = trades30d.length > 0 ? wins.length / trades30d.length : 0;
    
    const grossProfit = wins.reduce((sum, t) => sum + t.closedPnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.closedPnl, 0));
    const profitFactor = grossLoss > 0 
      ? Math.min(grossProfit / grossLoss, 100) 
      : (grossProfit > 0 ? 10 : 0);

    // Trade statistics
    const avgTradeSize = trades30d.length > 0 
      ? trades30d.reduce((sum, t) => sum + t.size, 0) / trades30d.length 
      : 0;
    const largestWin = wins.length > 0 ? Math.max(...wins.map(t => t.closedPnl)) : 0;
    const largestLoss = losses.length > 0 ? Math.min(...losses.map(t => t.closedPnl)) : 0;
    
    const avgWinnerPct = wins.length > 0 
      ? wins.reduce((sum, t) => sum + Math.abs(t.pnlPct), 0) / wins.length 
      : 0;
    const avgLoserPct = losses.length > 0 
      ? losses.reduce((sum, t) => sum + Math.abs(t.pnlPct), 0) / losses.length 
      : 0;

    // Streaks
    const { maxWinStreak, maxLossStreak } = calculateStreaks(trades30d);

    // Hold time and frequency
    const tradeFrequencyPerDay = trades30d.length / 30;
    const avgHoldTimeHours = estimateAvgHoldTime(fills30d);

    // ============================================
    // Step 8: Drawdown from equity history
    // ============================================
    let maxDrawdown7d = 0;
    let maxDrawdown30d = 0;
    let currentDrawdown = 0;
    let peakEquity = accountValue;

    if (hasEquityHistory) {
      maxDrawdown7d = calculateMaxDrawdown(equityHistory, accountValue, 7);
      maxDrawdown30d = calculateMaxDrawdown(equityHistory, accountValue, 30);
      const allTimeHigh = Math.max(...equityHistory.map(s => s.account_value), accountValue);
      peakEquity = allTimeHigh;
      currentDrawdown = allTimeHigh > 0 ? ((allTimeHigh - accountValue) / allTimeHigh) * 100 : 0;
    }

    // ============================================
    // Step 9: Strategy classification
    // ============================================
    const strategyType = classifyStrategy(trades30d, avgHoldTimeHours, tradeFrequencyPerDay);

    // ============================================
    // Step 10: Risk-adjusted returns
    // ============================================
    const { sharpeRatio, sortinoRatio } = hasEquityHistory
      ? calculateRiskMetrics(equityHistory, accountValue)
      : { sharpeRatio: 0, sortinoRatio: 0 };
    
    const consistencyScore = calculateConsistencyScore({
      winRate,
      profitFactor,
      maxDrawdown30d,
      sharpeRatio,
      tradeCount: trades30d.length,
    });

    // ============================================
    // Step 11: Quality tier classification
    // ============================================
    const { tier, reasons } = determineQualityTier({
      accountValue,
      pnl7d,
      pnl30d,
      roi7dPct,
      roi30dPct,
      winRate,
      profitFactor,
      totalTrades: trades30d.length,
      maxDrawdown30d,
      consistencyScore,
    });

    // ============================================
    // Step 12: Build result
    // ============================================
    const analysis: TraderAnalysis = {
      address: addrLower,
      account_value: accountValue,
      
      pnl_7d: pnl7d,
      pnl_30d: pnl30d,
      pnl_60d: pnl60d,
      pnl_90d: pnl90d,
      
      roi_7d_pct: roi7dPct,
      roi_30d_pct: roi30dPct,
      roi_60d_pct: roi60dPct,
      roi_90d_pct: roi90dPct,
      
      realized_pnl_7d: realizedPnl7d,
      realized_pnl_30d: realizedPnl30d,
      
      win_rate: winRate,
      profit_factor: profitFactor,
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
      
      has_equity_history: hasEquityHistory,
      equity_history_days: historyDays,
      pnl_calculation_method: calculationMethod,
    };

    // Log result
    const methodIcon = calculationMethod === 'equity_change' ? '📊' : '📝';
    const strategyEmoji = getStrategyEmoji(strategyType);
    
    logger.info(
      `${methodIcon} ${addrLower.slice(0, 10)}... | ` +
      `${tier.toUpperCase().padEnd(5)} | ` +
      `7d: ${pnl7d >= 0 ? '+' : ''}$${pnl7d.toFixed(0).padStart(6)} (${roi7dPct >= 0 ? '+' : ''}${roi7dPct.toFixed(1)}%) | ` +
      `WR: ${(winRate * 100).toFixed(0)}% | ` +
      `${strategyEmoji} | ` +
      `${trades30d.length} trades`
    );

    return analysis;

  } catch (error) {
    logger.error(`Failed to analyze ${address}`, error);
    return null;
  }
}

// ============================================
// P&L Calculation Functions
// ============================================

/**
 * Sum realized P&L from fills
 * NOTE: Fills MUST be pre-filtered by time before calling this
 */
function sumRealizedPnl(fills: Fill[]): number {
  let total = 0;
  for (const fill of fills) {
    const pnl = parseFloat(fill.closedPnl || '0');
    if (!isNaN(pnl)) {
      total += pnl;
    }
  }
  return total;
}

/**
 * Calculate P&L as equity change over time
 * This is the accurate method that matches Hyperdash
 */
function calculateEquityChange(
  snapshots: EquitySnapshot[], 
  currentEquity: number, 
  daysBack: number
): number {
  if (snapshots.length === 0) return 0;
  
  const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];
  
  // Find the oldest snapshot within the window, or the closest one before it
  const sortedSnapshots = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  
  // Look for snapshot closest to (but not after) the cutoff
  let pastSnapshot: EquitySnapshot | null = null;
  for (const snap of sortedSnapshots) {
    if (snap.date <= cutoffStr) {
      pastSnapshot = snap;
    } else {
      break;
    }
  }
  
  // If no snapshot before cutoff, use the earliest we have
  if (!pastSnapshot && sortedSnapshots.length > 0) {
    pastSnapshot = sortedSnapshots[0];
  }
  
  if (!pastSnapshot) return 0;
  
  return currentEquity - pastSnapshot.account_value;
}

function calculateRoi(pnl: number, baseEquity: number): number {
  // Base equity is what they had before the P&L
  const effectiveBase = Math.max(baseEquity, 100); // Avoid division by zero
  const roi = (pnl / effectiveBase) * 100;
  return Math.max(-100, Math.min(1000, roi)); // Clamp to reasonable range
}

// ============================================
// Equity Snapshot Functions
// ============================================

async function getEquitySnapshots(address: string, days: number): Promise<EquitySnapshot[]> {
  try {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];
    
    const { data, error } = await db.client
      .from('trader_equity_history')
      .select('snapshot_date, account_value')
      .eq('address', address)
      .gte('snapshot_date', cutoffStr)
      .order('snapshot_date', { ascending: true });
    
    if (error) {
      logger.debug(`Error fetching equity history: ${error.message}`);
      return [];
    }
    
    if (!data || data.length === 0) {
      return [];
    }
    
    return data.map(row => ({
      date: row.snapshot_date,
      account_value: parseFloat(row.account_value) || 0,
    }));
  } catch (err) {
    return [];
  }
}

async function saveEquitySnapshot(address: string, accountValue: number): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const { error } = await db.client.from('trader_equity_history').upsert({
      address: address,
      snapshot_date: today,
      account_value: accountValue,
      peak_value: accountValue,
      drawdown_pct: 0,
      daily_pnl: 0,
      daily_roi_pct: 0,
      trades_count: 0,
      wins_count: 0,
      losses_count: 0,
    }, { 
      onConflict: 'address,snapshot_date',
    });
    
    if (error) {
      logger.debug(`Error saving equity snapshot: ${error.message}`);
    }
  } catch (err) {
    // Silently fail - don't break analysis if snapshot fails
  }
}

// ============================================
// Drawdown Calculations
// ============================================

function calculateMaxDrawdown(
  snapshots: EquitySnapshot[], 
  currentEquity: number,
  daysBack: number
): number {
  const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];
  
  // Filter to relevant timeframe and add current equity
  const relevantSnapshots = snapshots
    .filter(s => s.date >= cutoffStr)
    .map(s => s.account_value);
  
  relevantSnapshots.push(currentEquity);
  
  if (relevantSnapshots.length < 2) return 0;
  
  let peak = relevantSnapshots[0];
  let maxDrawdown = 0;
  
  for (const equity of relevantSnapshots) {
    if (equity > peak) {
      peak = equity;
    }
    if (peak > 0) {
      const drawdown = ((peak - equity) / peak) * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
  }
  
  return maxDrawdown;
}

function calculateRiskMetrics(
  snapshots: EquitySnapshot[],
  currentEquity: number
): { sharpeRatio: number; sortinoRatio: number } {
  if (snapshots.length < 7) {
    return { sharpeRatio: 0, sortinoRatio: 0 };
  }

  // Add current equity as today's snapshot
  const equityValues = [...snapshots.map(s => s.account_value), currentEquity];
  
  // Calculate daily returns
  const returns: number[] = [];
  for (let i = 1; i < equityValues.length; i++) {
    if (equityValues[i - 1] > 0) {
      const dailyReturn = (equityValues[i] - equityValues[i - 1]) / equityValues[i - 1];
      returns.push(dailyReturn);
    }
  }

  if (returns.length < 5) {
    return { sharpeRatio: 0, sortinoRatio: 0 };
  }

  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  
  // Standard deviation
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  // Downside deviation (only negative returns)
  const negReturns = returns.filter(r => r < 0);
  const downsideVariance = negReturns.length > 0
    ? negReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negReturns.length
    : 0.000001;
  const downsideDev = Math.sqrt(downsideVariance);

  // Annualize (crypto trades 365 days)
  const annualFactor = Math.sqrt(365);
  
  const sharpeRatio = stdDev > 0.0001 
    ? (avgReturn / stdDev) * annualFactor 
    : 0;
  const sortinoRatio = downsideDev > 0.0001 
    ? (avgReturn / downsideDev) * annualFactor 
    : 0;

  return {
    sharpeRatio: Math.max(-10, Math.min(10, sharpeRatio)),
    sortinoRatio: Math.max(-10, Math.min(10, sortinoRatio)),
  };
}

// ============================================
// Trade Processing
// ============================================

function processTradesFromFills(fills: Fill[]): TradeData[] {
  const trades: TradeData[] = [];
  
  for (const fill of fills) {
    const closedPnl = parseFloat(fill.closedPnl || '0');
    
    // Only count fills that closed a position (have realized P&L)
    if (closedPnl !== 0 && !isNaN(closedPnl)) {
      const price = parseFloat(fill.px) || 0;
      const size = Math.abs(parseFloat(fill.sz) || 0) * price;
      const direction: 'long' | 'short' = fill.dir?.toLowerCase().includes('long') ? 'long' : 'short';
      
      // Calculate P&L percentage based on position size
      const pnlPct = size > 0 ? (closedPnl / size) * 100 : 0;
      
      trades.push({
        coin: fill.coin,
        closedPnl,
        size,
        exitTime: fill.time,
        direction,
        pnlPct: Math.abs(pnlPct), // Store as absolute for avg calculations
      });
    }
  }

  return trades;
}

function calculateStreaks(trades: TradeData[]): { maxWinStreak: number; maxLossStreak: number } {
  if (trades.length === 0) return { maxWinStreak: 0, maxLossStreak: 0 };
  
  // Sort by exit time
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  
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

function estimateAvgHoldTime(fills: Fill[]): number {
  // Group fills by coin to estimate hold times
  const coinFills = new Map<string, Fill[]>();
  
  for (const fill of fills) {
    const existing = coinFills.get(fill.coin) || [];
    existing.push(fill);
    coinFills.set(fill.coin, existing);
  }
  
  const holdTimes: number[] = [];
  
  for (const [, coinFillList] of coinFills) {
    // Sort by time
    const sorted = [...coinFillList].sort((a, b) => a.time - b.time);
    
    // Look for open/close pairs
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      
      // If current fill closes a position
      if (parseFloat(curr.closedPnl || '0') !== 0) {
        const holdTimeHours = (curr.time - prev.time) / (1000 * 60 * 60);
        if (holdTimeHours > 0 && holdTimeHours < 720) { // Max 30 days
          holdTimes.push(holdTimeHours);
        }
      }
    }
  }
  
  if (holdTimes.length === 0) return 0;
  return holdTimes.reduce((sum, h) => sum + h, 0) / holdTimes.length;
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

  // Position trader: Very long holds (1 week+)
  if (avgHoldTimeHours >= 168) {
    return 'position';
  }

  // Swing trader: Multi-day holds
  if (avgHoldTimeHours >= 24 && avgHoldTimeHours < 168) {
    return 'swing';
  }

  // Day trader categories
  if (avgHoldTimeHours < 4) {
    return tradeFrequencyPerDay >= 3 ? 'scalper' : 'momentum';
  }

  // Default based on win pattern
  const winRate = trades.filter(t => t.closedPnl > 0).length / trades.length;
  if (winRate > 0.6) {
    return 'momentum'; // High win rate = following trends
  } else if (winRate < 0.4) {
    return 'mean_reversion'; // Low win rate but profitable = big winners
  }

  return avgHoldTimeHours < 24 ? 'momentum' : 'swing';
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
// Consistency Score
// ============================================

function calculateConsistencyScore(metrics: {
  winRate: number;
  profitFactor: number;
  maxDrawdown30d: number;
  sharpeRatio: number;
  tradeCount: number;
}): number {
  let score = 0;

  // Win rate (0-25 points)
  if (metrics.winRate >= 0.6) score += 25;
  else if (metrics.winRate >= 0.5) score += 20;
  else if (metrics.winRate >= 0.45) score += 15;
  else if (metrics.winRate >= 0.4) score += 10;

  // Profit factor (0-25 points)
  if (metrics.profitFactor >= 3) score += 25;
  else if (metrics.profitFactor >= 2) score += 20;
  else if (metrics.profitFactor >= 1.5) score += 15;
  else if (metrics.profitFactor >= 1.2) score += 10;

  // Drawdown (0-25 points) - lower is better
  if (metrics.maxDrawdown30d <= 5) score += 25;
  else if (metrics.maxDrawdown30d <= 10) score += 20;
  else if (metrics.maxDrawdown30d <= 15) score += 15;
  else if (metrics.maxDrawdown30d <= 25) score += 10;

  // Sharpe ratio (0-25 points)
  if (metrics.sharpeRatio >= 3) score += 25;
  else if (metrics.sharpeRatio >= 2) score += 20;
  else if (metrics.sharpeRatio >= 1) score += 15;
  else if (metrics.sharpeRatio >= 0.5) score += 10;

  // Trade count adjustment
  if (metrics.tradeCount < 10) score -= 10;
  else if (metrics.tradeCount >= 50) score += 5;

  return Math.max(0, Math.min(100, score));
}

// ============================================
// Quality Tier Classification
// ============================================

function determineQualityTier(metrics: {
  accountValue: number;
  pnl7d: number;
  pnl30d: number;
  roi7dPct: number;
  roi30dPct: number;
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
  // ============================================
  const eliteChecks = {
    performance: metrics.roi7dPct >= elite.minRoi7dPct || metrics.pnl7d >= elite.minPnl7dAlt,
    multiTimeframe: metrics.pnl30d > 0,
    drawdown: metrics.maxDrawdown30d <= 25,
    winRate: metrics.winRate >= elite.minWinRate,
    profitFactor: metrics.profitFactor >= elite.minProfitFactor,
    trades: metrics.totalTrades >= elite.minTrades,
    accountValue: metrics.accountValue >= elite.minAccountValue,
    consistency: metrics.consistencyScore >= 50,
  };

  const eliteCore = eliteChecks.performance && 
                    eliteChecks.winRate && 
                    eliteChecks.profitFactor && 
                    eliteChecks.trades && 
                    eliteChecks.accountValue;

  const eliteBonus = eliteChecks.multiTimeframe && eliteChecks.drawdown;

  if (eliteCore && (eliteBonus || metrics.roi7dPct >= elite.minRoi7dPct * 2)) {
    reasons.push(`7d: ${metrics.pnl7d >= 0 ? '+' : ''}$${metrics.pnl7d.toFixed(0)}`);
    reasons.push(`ROI: ${metrics.roi7dPct.toFixed(1)}%`);
    reasons.push(`WR: ${(metrics.winRate * 100).toFixed(0)}%`);
    reasons.push(`PF: ${metrics.profitFactor.toFixed(2)}`);
    return { tier: 'elite', reasons };
  }

  // ============================================
  // GOOD TIER
  // ============================================
  const goodChecks = {
    performance: metrics.roi7dPct >= good.minRoi7dPct || metrics.pnl7d >= good.minPnl7dAlt,
    drawdown: metrics.maxDrawdown30d <= 35,
    winRate: metrics.winRate >= good.minWinRate,
    profitFactor: metrics.profitFactor >= good.minProfitFactor,
    trades: metrics.totalTrades >= good.minTrades,
    accountValue: metrics.accountValue >= good.minAccountValue,
  };

  if (Object.values(goodChecks).every(v => v)) {
    reasons.push(`7d: ${metrics.pnl7d >= 0 ? '+' : ''}$${metrics.pnl7d.toFixed(0)}`);
    reasons.push(`ROI: ${metrics.roi7dPct.toFixed(1)}%`);
    reasons.push(`WR: ${(metrics.winRate * 100).toFixed(0)}%`);
    return { tier: 'good', reasons };
  }

  // ============================================
  // WEAK TIER
  // ============================================
  if (!goodChecks.performance) reasons.push('Low P&L/ROI');
  if (!goodChecks.winRate) reasons.push(`WR: ${(metrics.winRate * 100).toFixed(0)}%`);
  if (!goodChecks.profitFactor) reasons.push(`PF: ${metrics.profitFactor.toFixed(2)}`);
  if (!goodChecks.trades) reasons.push(`${metrics.totalTrades} trades`);

  return { tier: 'weak', reasons };
}

// ============================================
// Empty Analysis Helper
// ============================================

function createEmptyAnalysis(address: string, accountValue: number): TraderAnalysis {
  return {
    address,
    account_value: accountValue,
    pnl_7d: 0, pnl_30d: 0, pnl_60d: 0, pnl_90d: 0,
    roi_7d_pct: 0, roi_30d_pct: 0, roi_60d_pct: 0, roi_90d_pct: 0,
    realized_pnl_7d: 0, realized_pnl_30d: 0,
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
    quality_reasons: ['No trading activity'],
    is_tracked: false,
    analyzed_at: new Date(),
    has_equity_history: false,
    equity_history_days: 0,
    pnl_calculation_method: 'realized_sum_filtered',
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
      logger.error(`Failed to save analysis: ${error.message}`);
    }
  } catch (error) {
    logger.error(`Failed to save analysis for ${analysis.address}`, error);
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

export async function getTrackedTraders(): Promise<TraderAnalysis[]> {
  const { data, error } = await db.client
    .from('trader_quality')
    .select('*')
    .eq('is_tracked', true)
    .order('quality_tier', { ascending: true })
    .order('roi_7d_pct', { ascending: false });

  return (error || !data) ? [] : data as TraderAnalysis[];
}

export async function analyzeTradersBatch(addresses: string[]): Promise<TraderAnalysis[]> {
  const results: TraderAnalysis[] = [];
  
  logger.info(`Analyzing ${addresses.length} traders with V6 analyzer...`);

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    
    const analysis = await analyzeTrader(address);
    if (analysis) {
      await saveTraderAnalysis(analysis);
      results.push(analysis);
    }
    
    // Progress log every 10 traders
    if ((i + 1) % 10 === 0) {
      logger.info(`Progress: ${i + 1}/${addresses.length} traders analyzed`);
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, config.rateLimit.delayBetweenRequests));
  }

  const elite = results.filter(r => r.quality_tier === 'elite').length;
  const good = results.filter(r => r.quality_tier === 'good').length;
  const weak = results.filter(r => r.quality_tier === 'weak').length;
  
  logger.info(`✅ Analysis complete: ${elite} elite, ${good} good, ${weak} weak`);

  return results;
}

export default {
  analyzeTrader,
  saveTraderAnalysis,
  getQualityStats,
  getTrackedTraders,
  analyzeTradersBatch,
};