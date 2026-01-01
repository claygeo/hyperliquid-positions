// PnL Analyzer V4
// Analyzes trader performance and assigns quality tiers
// Updated with ROI-based classification logic

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import hyperliquid from '../utils/hyperliquid-api.js';

const logger = createLogger('pnl-analyzer');

// ============================================
// Types
// ============================================

export interface TraderAnalysis {
  address: string;
  account_value: number;
  pnl_7d: number;
  pnl_30d: number;
  roi_7d_pct: number;
  roi_30d_pct: number;
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  avg_trade_size: number;
  largest_win: number;
  largest_loss: number;
  avg_hold_time_hours: number;
  quality_tier: 'elite' | 'good' | 'weak';
  quality_reasons: string[];
  is_tracked: boolean;
  analyzed_at: Date;
}

interface TradeData {
  closedPnl: number;
  size: number;
  entryTime: number;
  exitTime: number;
}

// ============================================
// Core Analysis Functions
// ============================================

/**
 * Fetch and analyze a trader's performance
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

    // Get recent fills (last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    
    const fills = await hyperliquid.getUserFills(address, thirtyDaysAgo);
    
    if (!fills || fills.length === 0) {
      return createEmptyAnalysis(address, accountValue);
    }

    // Process fills into trades
    const trades = processTradesFromFills(fills);
    
    if (trades.length === 0) {
      return createEmptyAnalysis(address, accountValue);
    }

    // Calculate metrics
    const trades7d = trades.filter(t => t.exitTime >= sevenDaysAgo);
    const trades30d = trades;

    const pnl7d = trades7d.reduce((sum, t) => sum + t.closedPnl, 0);
    const pnl30d = trades30d.reduce((sum, t) => sum + t.closedPnl, 0);

    // Calculate ROI with safety checks
    const roi7dPct = calculateRoi(pnl7d, accountValue);
    const roi30dPct = calculateRoi(pnl30d, accountValue);

    const wins = trades30d.filter(t => t.closedPnl > 0);
    const losses = trades30d.filter(t => t.closedPnl < 0);
    
    const winRate = trades30d.length > 0 ? wins.length / trades30d.length : 0;
    
    const grossProfit = wins.reduce((sum, t) => sum + t.closedPnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.closedPnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 10 : 0);

    const avgTradeSize = trades30d.reduce((sum, t) => sum + t.size, 0) / trades30d.length;
    const largestWin = wins.length > 0 ? Math.max(...wins.map(t => t.closedPnl)) : 0;
    const largestLoss = losses.length > 0 ? Math.min(...losses.map(t => t.closedPnl)) : 0;

    const holdTimes = trades30d
      .filter(t => t.exitTime > t.entryTime)
      .map(t => (t.exitTime - t.entryTime) / (1000 * 60 * 60));
    const avgHoldTimeHours = holdTimes.length > 0 
      ? holdTimes.reduce((sum, h) => sum + h, 0) / holdTimes.length 
      : 0;

    // Determine quality tier using new ROI-based logic
    const { tier, reasons } = determineQualityTier({
      accountValue,
      pnl7d,
      roi7dPct,
      winRate,
      profitFactor,
      totalTrades: trades30d.length,
    });

    const analysis: TraderAnalysis = {
      address: address.toLowerCase(),
      account_value: accountValue,
      pnl_7d: pnl7d,
      pnl_30d: pnl30d,
      roi_7d_pct: roi7dPct,
      roi_30d_pct: roi30dPct,
      win_rate: winRate,
      profit_factor: Math.min(profitFactor, 100), // Cap at 100 for sanity
      total_trades: trades30d.length,
      avg_trade_size: avgTradeSize,
      largest_win: largestWin,
      largest_loss: largestLoss,
      avg_hold_time_hours: avgHoldTimeHours,
      quality_tier: tier,
      quality_reasons: reasons,
      is_tracked: tier === 'elite' || tier === 'good',
      analyzed_at: new Date(),
    };

    logger.info(
      `Analyzed ${address.slice(0, 10)}... | ` +
      `${tier.toUpperCase()} | ` +
      `ROI: ${roi7dPct.toFixed(1)}% | ` +
      `PnL: $${pnl7d.toFixed(0)} | ` +
      `WR: ${(winRate * 100).toFixed(0)}% | ` +
      `PF: ${profitFactor.toFixed(2)} | ` +
      `${trades30d.length} trades`
    );

    return analysis;

  } catch (error) {
    logger.error(`Failed to analyze ${address}`, error);
    return null;
  }
}

/**
 * Calculate ROI with safety checks for edge cases
 */
function calculateRoi(pnl: number, accountValue: number): number {
  // If account is too small, can't calculate meaningful ROI
  if (accountValue < 100) {
    return 0;
  }
  
  const roi = (pnl / accountValue) * 100;
  
  // Cap at reasonable bounds to handle edge cases
  return Math.max(-100, Math.min(1000, roi));
}

/**
 * Determine quality tier using ROI-based logic
 * Uses OR logic: qualifies if ROI > threshold OR absolute PnL > alt threshold
 */
function determineQualityTier(metrics: {
  accountValue: number;
  pnl7d: number;
  roi7dPct: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
}): { tier: 'elite' | 'good' | 'weak'; reasons: string[] } {
  const { accountValue, pnl7d, roi7dPct, winRate, profitFactor, totalTrades } = metrics;
  const { elite, good } = config.quality;
  
  const reasons: string[] = [];

  // ============================================
  // Check for ELITE tier
  // ============================================
  const eliteChecks = {
    // Must pass EITHER ROI OR absolute PnL threshold
    passesPerformance: roi7dPct >= elite.minRoi7dPct || pnl7d >= elite.minPnl7dAlt,
    passesWinRate: winRate >= elite.minWinRate,
    passesProfitFactor: profitFactor >= elite.minProfitFactor,
    passesTrades: totalTrades >= elite.minTrades,
    passesAccountValue: accountValue >= elite.minAccountValue,
  };

  if (Object.values(eliteChecks).every(v => v)) {
    if (roi7dPct >= elite.minRoi7dPct) {
      reasons.push(`ROI ${roi7dPct.toFixed(1)}% >= ${elite.minRoi7dPct}%`);
    }
    if (pnl7d >= elite.minPnl7dAlt) {
      reasons.push(`PnL $${pnl7d.toFixed(0)} >= $${elite.minPnl7dAlt}`);
    }
    reasons.push(`WR ${(winRate * 100).toFixed(0)}% >= ${elite.minWinRate * 100}%`);
    reasons.push(`PF ${profitFactor.toFixed(2)} >= ${elite.minProfitFactor}`);
    reasons.push(`${totalTrades} trades >= ${elite.minTrades}`);
    
    return { tier: 'elite', reasons };
  }

  // ============================================
  // Check for GOOD tier
  // ============================================
  const goodChecks = {
    passesPerformance: roi7dPct >= good.minRoi7dPct || pnl7d >= good.minPnl7dAlt,
    passesWinRate: winRate >= good.minWinRate,
    passesProfitFactor: profitFactor >= good.minProfitFactor,
    passesTrades: totalTrades >= good.minTrades,
    passesAccountValue: accountValue >= good.minAccountValue,
  };

  if (Object.values(goodChecks).every(v => v)) {
    if (roi7dPct >= good.minRoi7dPct) {
      reasons.push(`ROI ${roi7dPct.toFixed(1)}% >= ${good.minRoi7dPct}%`);
    }
    if (pnl7d >= good.minPnl7dAlt) {
      reasons.push(`PnL $${pnl7d.toFixed(0)} >= $${good.minPnl7dAlt}`);
    }
    reasons.push(`WR ${(winRate * 100).toFixed(0)}% >= ${good.minWinRate * 100}%`);
    reasons.push(`PF ${profitFactor.toFixed(2)} >= ${good.minProfitFactor}`);
    reasons.push(`${totalTrades} trades >= ${good.minTrades}`);
    
    return { tier: 'good', reasons };
  }

  // ============================================
  // WEAK tier - explain why
  // ============================================
  if (roi7dPct < good.minRoi7dPct && pnl7d < good.minPnl7dAlt) {
    reasons.push(`ROI ${roi7dPct.toFixed(1)}% < ${good.minRoi7dPct}% AND PnL $${pnl7d.toFixed(0)} < $${good.minPnl7dAlt}`);
  }
  if (winRate < good.minWinRate) {
    reasons.push(`WR ${(winRate * 100).toFixed(0)}% < ${good.minWinRate * 100}%`);
  }
  if (profitFactor < good.minProfitFactor) {
    reasons.push(`PF ${profitFactor.toFixed(2)} < ${good.minProfitFactor}`);
  }
  if (totalTrades < good.minTrades) {
    reasons.push(`${totalTrades} trades < ${good.minTrades}`);
  }
  if (accountValue < good.minAccountValue) {
    reasons.push(`Account $${accountValue.toFixed(0)} < $${good.minAccountValue} (stale data?)`);
  }

  return { tier: 'weak', reasons };
}

/**
 * Process raw fills into aggregated trades
 */
function processTradesFromFills(fills: any[]): TradeData[] {
  const trades: TradeData[] = [];
  
  // Group fills by coin
  const fillsByCoin = new Map<string, any[]>();
  for (const fill of fills) {
    const existing = fillsByCoin.get(fill.coin) || [];
    existing.push(fill);
    fillsByCoin.set(fill.coin, existing);
  }

  // Process each coin's fills
  for (const [coin, coinFills] of fillsByCoin) {
    // Sort by time
    coinFills.sort((a, b) => a.time - b.time);
    
    for (const fill of coinFills) {
      const closedPnl = parseFloat(fill.closedPnl || '0');
      
      // Only count as a trade if there's realized PnL
      if (closedPnl !== 0) {
        trades.push({
          closedPnl,
          size: Math.abs(parseFloat(fill.sz)) * parseFloat(fill.px),
          entryTime: fill.time - (60 * 60 * 1000), // Estimate entry as 1 hour before
          exitTime: fill.time,
        });
      }
    }
  }

  return trades;
}

/**
 * Create empty analysis for traders with no trades
 */
function createEmptyAnalysis(address: string, accountValue: number): TraderAnalysis {
  return {
    address: address.toLowerCase(),
    account_value: accountValue,
    pnl_7d: 0,
    pnl_30d: 0,
    roi_7d_pct: 0,
    roi_30d_pct: 0,
    win_rate: 0,
    profit_factor: 0,
    total_trades: 0,
    avg_trade_size: 0,
    largest_win: 0,
    largest_loss: 0,
    avg_hold_time_hours: 0,
    quality_tier: 'weak',
    quality_reasons: ['No trades in last 30 days'],
    is_tracked: false,
    analyzed_at: new Date(),
  };
}

// ============================================
// Database Operations
// ============================================

/**
 * Save trader analysis to database
 */
export async function saveTraderAnalysis(analysis: TraderAnalysis): Promise<void> {
  try {
    const { error } = await db.client.from('trader_quality').upsert({
      address: analysis.address,
      account_value: analysis.account_value,
      pnl_7d: analysis.pnl_7d,
      pnl_30d: analysis.pnl_30d,
      roi_7d_pct: analysis.roi_7d_pct,
      roi_30d_pct: analysis.roi_30d_pct,
      win_rate: analysis.win_rate,
      profit_factor: analysis.profit_factor,
      total_trades: analysis.total_trades,
      avg_trade_size: analysis.avg_trade_size,
      largest_win: analysis.largest_win,
      largest_loss: analysis.largest_loss,
      avg_hold_time_hours: analysis.avg_hold_time_hours,
      quality_tier: analysis.quality_tier,
      quality_reasons: analysis.quality_reasons,
      is_tracked: analysis.is_tracked,
      analyzed_at: analysis.analyzed_at.toISOString(),
    }, { onConflict: 'address' });

    if (error) {
      logger.error(`Failed to save analysis for ${analysis.address}`, error);
    }
  } catch (error) {
    logger.error(`Failed to save analysis for ${analysis.address}`, error);
  }
}

/**
 * Get quality statistics
 */
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

/**
 * Get traders by tier
 */
export async function getTradersByTier(tier: 'elite' | 'good' | 'weak'): Promise<TraderAnalysis[]> {
  const { data, error } = await db.client
    .from('trader_quality')
    .select('*')
    .eq('quality_tier', tier)
    .order('pnl_7d', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data as TraderAnalysis[];
}

/**
 * Get all tracked traders
 */
export async function getTrackedTraders(): Promise<TraderAnalysis[]> {
  const { data, error } = await db.client
    .from('trader_quality')
    .select('*')
    .eq('is_tracked', true)
    .order('quality_tier', { ascending: true })
    .order('pnl_7d', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data as TraderAnalysis[];
}

/**
 * Analyze multiple traders in batch
 */
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
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, config.rateLimit.delayBetweenRequests));
    }

    // Batch delay
    if (i + config.analysis.batchSize < addresses.length) {
      await new Promise(resolve => setTimeout(resolve, config.analysis.batchDelayMs));
    }
  }

  const elite = results.filter(r => r.quality_tier === 'elite').length;
  const good = results.filter(r => r.quality_tier === 'good').length;
  
  logger.info(`Analysis complete: ${elite} elite, ${good} good, ${results.length - elite - good} weak`);

  return results;
}

/**
 * Re-analyze all tracked traders
 */
export async function reanalyzeTrackedTraders(): Promise<void> {
  const tracked = await getTrackedTraders();
  
  if (tracked.length === 0) {
    logger.info('No tracked traders to re-analyze');
    return;
  }

  logger.info(`Re-analyzing ${tracked.length} tracked traders...`);

  for (const trader of tracked) {
    const analysis = await analyzeTrader(trader.address);
    if (analysis) {
      await saveTraderAnalysis(analysis);
      
      // Log tier changes
      if (analysis.quality_tier !== trader.quality_tier) {
        const direction = analysis.quality_tier === 'weak' ? '⬇️' : 
                         (trader.quality_tier === 'weak' ? '⬆️' : '↔️');
        logger.info(
          `${direction} TIER CHANGE: ${trader.address.slice(0, 10)}... ` +
          `${trader.quality_tier} → ${analysis.quality_tier}`
        );
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, config.rateLimit.delayBetweenRequests));
  }
}

export default {
  analyzeTrader,
  saveTraderAnalysis,
  getQualityStats,
  getTradersByTier,
  getTrackedTraders,
  analyzeTradersBatch,
  reanalyzeTrackedTraders,
};