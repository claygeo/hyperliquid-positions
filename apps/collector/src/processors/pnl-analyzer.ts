// PnL Analyzer V2 - Stricter quality thresholds for better signals
// Changes from V1:
// - Added profit factor calculation
// - Uses 30-day PnL in classification (not just 7d)
// - Minimum trade requirements (10 for Good, 20 for Elite)
// - Higher PnL thresholds ($5k for Good, $25k for Elite)
// - Better quality score formula

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';

const logger = createLogger('pnl-analyzer');

const HYPERLIQUID_API = config.hyperliquid.api;

// ============================================
// V2 Quality Thresholds (stricter)
// ============================================

const QUALITY_THRESHOLDS = {
  elite: {
    minPnl7d: 25000,        // $25k minimum 7-day PnL
    minPnl30d: 25000,       // $25k minimum 30-day PnL (NEW)
    minWinRate: 0.50,       // 50% win rate
    minTrades: 15,          // At least 15 closed trades (NEW)
    minProfitFactor: 1.5,   // Wins 1.5x larger than losses (NEW)
  },
  good: {
    minPnl7d: 5000,         // $5k minimum (was $0)
    minPnl30d: 5000,        // $5k 30-day (NEW)
    minWinRate: 0.48,       // 48% win rate (was 45%)
    minTrades: 8,           // At least 8 closed trades (NEW)
    minProfitFactor: 1.2,   // Wins 1.2x larger than losses (NEW)
  },
};

// ============================================
// Types
// ============================================

interface Fill {
  coin: string;
  px: string;
  sz: string;
  side: string;
  time: number;
  closedPnl: string;
  dir: string;
  hash: string;
  fee: string;
}

interface AssetPosition {
  position: {
    coin: string;
    szi: string;
    entryPx: string;
    positionValue: string;
    unrealizedPnl: string;
    leverage: { value: string };
  };
}

interface ClearinghouseState {
  marginSummary: {
    accountValue: string;
    totalMarginUsed: string;
    totalNtlPos: string;
  };
  assetPositions: AssetPosition[];
}

interface PnLStats {
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
  avgSize: number;
  grossWins: number;
  grossLosses: number;
  profitFactor: number;
  largestWin: number;
  largestLoss: number;
  avgWin: number;
  avgLoss: number;
}

interface TraderAnalysis {
  address: string;
  pnl_7d: number;
  pnl_30d: number;
  trades_7d: number;
  trades_30d: number;
  wins_7d: number;
  losses_7d: number;
  win_rate: number;
  profit_factor: number;
  avg_trade_size: number;
  avg_win: number;
  avg_loss: number;
  largest_win: number;
  largest_loss: number;
  account_value: number;
  quality_score: number;
  quality_tier: 'elite' | 'good' | 'weak';
  is_active_trader: boolean;
  has_open_positions: boolean;
  rejection_reason?: string;
}

// ============================================
// API Calls
// ============================================

async function fetchUserFills(address: string, startTime?: number): Promise<Fill[]> {
  try {
    const response = await fetch(HYPERLIQUID_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'userFills',
        user: address,
        startTime: startTime,
      }),
    });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    return [];
  }
}

async function fetchClearinghouseState(address: string): Promise<ClearinghouseState | null> {
  try {
    const response = await fetch(HYPERLIQUID_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clearinghouseState',
        user: address,
      }),
    });
    
    if (!response.ok) return null;
    
    return await response.json() as ClearinghouseState;
  } catch (error) {
    return null;
  }
}

// ============================================
// Analysis Logic (V2 - with profit factor)
// ============================================

function calculatePnL(fills: Fill[], days: number): PnLStats {
  const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
  
  // Filter fills within time window
  const recentFills = fills.filter(f => f.time >= cutoffTime);
  
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;
  let grossWins = 0;
  let grossLosses = 0;
  let totalSize = 0;
  let closingTrades = 0;
  let largestWin = 0;
  let largestLoss = 0;
  
  for (const fill of recentFills) {
    const closedPnl = parseFloat(fill.closedPnl || '0');
    const size = parseFloat(fill.sz || '0') * parseFloat(fill.px || '0');
    
    // Only count trades that closed a position (have non-zero closedPnl)
    if (closedPnl !== 0) {
      totalPnl += closedPnl;
      closingTrades++;
      
      if (closedPnl > 0) {
        wins++;
        grossWins += closedPnl;
        largestWin = Math.max(largestWin, closedPnl);
      } else {
        losses++;
        grossLosses += Math.abs(closedPnl);
        largestLoss = Math.max(largestLoss, Math.abs(closedPnl));
      }
    }
    
    totalSize += size;
  }
  
  // Calculate profit factor (gross wins / gross losses)
  // PF > 1.0 = profitable, PF > 2.0 = excellent
  const profitFactor = grossLosses > 0 
    ? grossWins / grossLosses 
    : grossWins > 0 ? 10 : 0; // Cap at 10 if no losses
  
  const avgWin = wins > 0 ? grossWins / wins : 0;
  const avgLoss = losses > 0 ? grossLosses / losses : 0;
  
  return {
    pnl: totalPnl,
    trades: closingTrades,
    wins,
    losses,
    avgSize: closingTrades > 0 ? totalSize / recentFills.length : 0,
    grossWins,
    grossLosses,
    profitFactor,
    largestWin,
    largestLoss,
    avgWin,
    avgLoss,
  };
}

function calculateQualityScore(analysis: {
  pnl_7d: number;
  pnl_30d: number;
  win_rate: number;
  profit_factor: number;
  trades_7d: number;
  account_value: number;
}): number {
  let score = 0;
  
  // 7d PnL contribution (0-25 points)
  if (analysis.pnl_7d >= 100000) score += 25;
  else if (analysis.pnl_7d >= 50000) score += 22;
  else if (analysis.pnl_7d >= 25000) score += 18;
  else if (analysis.pnl_7d >= 10000) score += 14;
  else if (analysis.pnl_7d >= 5000) score += 10;
  else if (analysis.pnl_7d >= 1000) score += 5;
  else if (analysis.pnl_7d < 0) score -= 5;
  
  // 30d PnL contribution (0-20 points) - NEW
  if (analysis.pnl_30d >= 100000) score += 20;
  else if (analysis.pnl_30d >= 50000) score += 16;
  else if (analysis.pnl_30d >= 25000) score += 12;
  else if (analysis.pnl_30d >= 10000) score += 8;
  else if (analysis.pnl_30d >= 5000) score += 4;
  else if (analysis.pnl_30d < 0) score -= 5;
  
  // Win rate contribution (0-20 points)
  if (analysis.win_rate >= 0.65) score += 20;
  else if (analysis.win_rate >= 0.58) score += 16;
  else if (analysis.win_rate >= 0.52) score += 12;
  else if (analysis.win_rate >= 0.48) score += 8;
  else if (analysis.win_rate >= 0.45) score += 4;
  
  // Profit Factor contribution (0-20 points) - NEW
  if (analysis.profit_factor >= 3.0) score += 20;
  else if (analysis.profit_factor >= 2.5) score += 17;
  else if (analysis.profit_factor >= 2.0) score += 14;
  else if (analysis.profit_factor >= 1.5) score += 10;
  else if (analysis.profit_factor >= 1.2) score += 6;
  else if (analysis.profit_factor >= 1.0) score += 2;
  
  // Trade count / statistical significance (0-10 points) - NEW
  if (analysis.trades_7d >= 50) score += 10;
  else if (analysis.trades_7d >= 30) score += 8;
  else if (analysis.trades_7d >= 20) score += 6;
  else if (analysis.trades_7d >= 10) score += 4;
  else if (analysis.trades_7d >= 5) score += 2;
  
  // Account value contribution (0-5 points)
  if (analysis.account_value >= 500000) score += 5;
  else if (analysis.account_value >= 100000) score += 4;
  else if (analysis.account_value >= 50000) score += 3;
  else if (analysis.account_value >= 10000) score += 2;
  
  return Math.max(0, Math.min(100, score));
}

function determineQualityTier(
  pnl_7d: number,
  pnl_30d: number,
  win_rate: number,
  trades_7d: number,
  trades_30d: number,
  profitFactor: number
): { tier: 'elite' | 'good' | 'weak'; reason?: string } {
  
  const t = QUALITY_THRESHOLDS;
  
  // ========== ELITE ==========
  // Must pass ALL criteria
  if (
    pnl_7d >= t.elite.minPnl7d &&
    pnl_30d >= t.elite.minPnl30d &&
    win_rate >= t.elite.minWinRate &&
    trades_30d >= t.elite.minTrades &&
    profitFactor >= t.elite.minProfitFactor
  ) {
    return { tier: 'elite' };
  }
  
  // ========== GOOD ==========
  // Must pass ALL criteria
  if (
    pnl_7d >= t.good.minPnl7d &&
    pnl_30d >= t.good.minPnl30d &&
    win_rate >= t.good.minWinRate &&
    trades_30d >= t.good.minTrades &&
    profitFactor >= t.good.minProfitFactor
  ) {
    return { tier: 'good' };
  }
  
  // ========== WEAK - with rejection reason ==========
  let reason = '';
  
  if (trades_30d < t.good.minTrades) {
    reason = `Insufficient trades (${trades_30d} < ${t.good.minTrades})`;
  } else if (pnl_7d < t.good.minPnl7d) {
    reason = `7d PnL too low ($${pnl_7d.toFixed(0)} < $${t.good.minPnl7d})`;
  } else if (pnl_30d < t.good.minPnl30d) {
    reason = `30d PnL too low ($${pnl_30d.toFixed(0)} < $${t.good.minPnl30d})`;
  } else if (win_rate < t.good.minWinRate) {
    reason = `Win rate too low (${(win_rate * 100).toFixed(1)}% < ${t.good.minWinRate * 100}%)`;
  } else if (profitFactor < t.good.minProfitFactor) {
    reason = `Profit factor too low (${profitFactor.toFixed(2)} < ${t.good.minProfitFactor})`;
  }
  
  return { tier: 'weak', reason };
}

export async function analyzeTrader(address: string): Promise<TraderAnalysis | null> {
  try {
    // Fetch clearinghouse state (account info + positions)
    const state = await fetchClearinghouseState(address);
    
    if (!state) {
      return null;
    }
    
    const accountValue = parseFloat(state.marginSummary?.accountValue || '0');
    const hasOpenPositions = state.assetPositions?.some(
      ap => parseFloat(ap.position?.szi || '0') !== 0
    ) || false;
    
    // Fetch recent fills (last 30 days)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const fills = await fetchUserFills(address, thirtyDaysAgo);
    
    // Calculate PnL for different windows
    const stats7d = calculatePnL(fills, 7);
    const stats30d = calculatePnL(fills, 30);
    
    // Calculate win rate (use 30d for more statistical significance)
    const totalTrades = stats30d.wins + stats30d.losses;
    const winRate = totalTrades > 0 ? stats30d.wins / totalTrades : 0;
    
    // Use 30d profit factor (more reliable than 7d)
    const profitFactor = stats30d.profitFactor;
    
    // Calculate quality score
    const qualityScore = calculateQualityScore({
      pnl_7d: stats7d.pnl,
      pnl_30d: stats30d.pnl,
      win_rate: winRate,
      profit_factor: profitFactor,
      trades_7d: stats7d.trades,
      account_value: accountValue,
    });
    
    // Determine tier with stricter V2 logic
    const { tier: qualityTier, reason } = determineQualityTier(
      stats7d.pnl,
      stats30d.pnl,
      winRate,
      stats7d.trades,
      stats30d.trades,
      profitFactor
    );
    
    // Is active trader? (has trades in last 7 days OR open positions)
    const isActiveTrader = stats7d.trades > 0 || hasOpenPositions;
    
    return {
      address,
      pnl_7d: stats7d.pnl,
      pnl_30d: stats30d.pnl,
      trades_7d: stats7d.trades,
      trades_30d: stats30d.trades,
      wins_7d: stats7d.wins,
      losses_7d: stats7d.losses,
      win_rate: winRate,
      profit_factor: profitFactor,
      avg_trade_size: stats30d.avgSize,
      avg_win: stats30d.avgWin,
      avg_loss: stats30d.avgLoss,
      largest_win: stats30d.largestWin,
      largest_loss: stats30d.largestLoss,
      account_value: accountValue,
      quality_score: qualityScore,
      quality_tier: qualityTier,
      is_active_trader: isActiveTrader,
      has_open_positions: hasOpenPositions,
      rejection_reason: reason,
    };
  } catch (error) {
    logger.error(`Failed to analyze ${address}`, error);
    return null;
  }
}

export async function saveTraderAnalysis(analysis: TraderAnalysis): Promise<void> {
  // Update hype_holders
  await db.client
    .from('hype_holders')
    .update({
      is_active_trader: analysis.is_active_trader,
      last_trade_at: analysis.trades_7d > 0 ? new Date().toISOString() : null,
    })
    .eq('address', analysis.address);
  
  // Upsert trader_quality with new V2 fields
  await db.client
    .from('trader_quality')
    .upsert({
      address: analysis.address,
      pnl_7d: analysis.pnl_7d,
      pnl_30d: analysis.pnl_30d,
      trades_7d: analysis.trades_7d,
      trades_30d: analysis.trades_30d,
      wins_7d: analysis.wins_7d,
      losses_7d: analysis.losses_7d,
      win_rate: analysis.win_rate,
      profit_factor: analysis.profit_factor,
      avg_trade_size: analysis.avg_trade_size,
      avg_win: analysis.avg_win,
      avg_loss: analysis.avg_loss,
      largest_win: analysis.largest_win,
      largest_loss: analysis.largest_loss,
      account_value: analysis.account_value,
      quality_score: analysis.quality_score,
      quality_tier: analysis.quality_tier,
      is_tracked: analysis.quality_tier === 'elite' || analysis.quality_tier === 'good',
      analyzed_at: new Date().toISOString(),
    }, { onConflict: 'address' });
}

export async function analyzeAllTraders(onProgress?: (current: number, total: number) => void): Promise<{
  total: number;
  analyzed: number;
  elite: number;
  good: number;
  weak: number;
}> {
  // Get all holders that need analysis
  const result = await db.client
    .from('hype_holders')
    .select('address')
    .order('hype_balance', { ascending: false });
  
  if (result.error || !result.data) {
    throw new Error('Failed to fetch holders');
  }
  
  const holders = result.data as { address: string }[];
  const total = holders.length;
  
  let analyzed = 0;
  let elite = 0;
  let good = 0;
  let weak = 0;
  
  logger.info(`Starting V2 analysis of ${total} holders...`);
  logger.info(`Elite requires: $${QUALITY_THRESHOLDS.elite.minPnl7d} 7d, $${QUALITY_THRESHOLDS.elite.minPnl30d} 30d, ${QUALITY_THRESHOLDS.elite.minWinRate * 100}% WR, ${QUALITY_THRESHOLDS.elite.minTrades} trades, ${QUALITY_THRESHOLDS.elite.minProfitFactor} PF`);
  logger.info(`Good requires: $${QUALITY_THRESHOLDS.good.minPnl7d} 7d, $${QUALITY_THRESHOLDS.good.minPnl30d} 30d, ${QUALITY_THRESHOLDS.good.minWinRate * 100}% WR, ${QUALITY_THRESHOLDS.good.minTrades} trades, ${QUALITY_THRESHOLDS.good.minProfitFactor} PF`);
  
  // Process in batches
  const batchSize = config.analysis?.batchSize || 10;
  const batchDelayMs = config.analysis?.batchDelayMs || 1000;
  
  for (let i = 0; i < holders.length; i += batchSize) {
    const batch = holders.slice(i, i + batchSize);
    
    // Analyze batch concurrently
    const results = await Promise.all(
      batch.map(h => analyzeTrader(h.address))
    );
    
    // Save results
    for (const analysis of results) {
      if (analysis) {
        await saveTraderAnalysis(analysis);
        analyzed++;
        
        if (analysis.quality_tier === 'elite') elite++;
        else if (analysis.quality_tier === 'good') good++;
        else weak++;
      }
    }
    
    // Progress callback
    if (onProgress) {
      onProgress(Math.min(i + batchSize, total), total);
    }
    
    // Rate limiting delay
    await new Promise(resolve => setTimeout(resolve, batchDelayMs));
    
    // Log progress every 100
    if ((i + batchSize) % 100 === 0 || i + batchSize >= total) {
      const pct = Math.round(((i + batchSize) / total) * 100);
      logger.info(`Progress: ${Math.min(i + batchSize, total)}/${total} (${pct}%) - Elite: ${elite}, Good: ${good}, Weak: ${weak}`);
    }
  }
  
  return { total, analyzed, elite, good, weak };
}

// Export for continuous analysis
export async function getQualityStats(): Promise<{ elite: number; good: number; tracked: number }> {
  const eliteResult = await db.client
    .from('trader_quality')
    .select('address', { count: 'exact', head: true })
    .eq('quality_tier', 'elite');
  
  const goodResult = await db.client
    .from('trader_quality')
    .select('address', { count: 'exact', head: true })
    .eq('quality_tier', 'good');
  
  const trackedResult = await db.client
    .from('trader_quality')
    .select('address', { count: 'exact', head: true })
    .eq('is_tracked', true);
  
  return {
    elite: eliteResult.count || 0,
    good: goodResult.count || 0,
    tracked: trackedResult.count || 0,
  };
}

export default {
  analyzeTrader,
  saveTraderAnalysis,
  analyzeAllTraders,
  getQualityStats,
};