// PnL Analyzer - Analyzes trader performance from Hyperliquid API
// Can be run as script or imported for continuous use

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';

const logger = createLogger('pnl-analyzer');

const HYPERLIQUID_API = config.hyperliquid.api;

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

interface TraderAnalysis {
  address: string;
  pnl_7d: number;
  pnl_30d: number;
  trades_7d: number;
  wins_7d: number;
  losses_7d: number;
  win_rate: number;
  avg_trade_size: number;
  account_value: number;
  quality_score: number;
  quality_tier: 'elite' | 'good' | 'weak';
  is_active_trader: boolean;
  has_open_positions: boolean;
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
// Analysis Logic
// ============================================

function calculatePnL(fills: Fill[], days: number): { pnl: number; trades: number; wins: number; losses: number; avgSize: number } {
  const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
  
  // Filter fills within time window
  const recentFills = fills.filter(f => f.time >= cutoffTime);
  
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;
  let totalSize = 0;
  let closingTrades = 0;
  
  for (const fill of recentFills) {
    const closedPnl = parseFloat(fill.closedPnl || '0');
    const size = parseFloat(fill.sz || '0') * parseFloat(fill.px || '0');
    
    // Only count trades that closed a position (have non-zero closedPnl)
    if (closedPnl !== 0) {
      totalPnl += closedPnl;
      closingTrades++;
      
      if (closedPnl > 0) {
        wins++;
      } else {
        losses++;
      }
    }
    
    totalSize += size;
  }
  
  return {
    pnl: totalPnl,
    trades: closingTrades,
    wins,
    losses,
    avgSize: closingTrades > 0 ? totalSize / recentFills.length : 0,
  };
}

function calculateQualityScore(analysis: {
  pnl_7d: number;
  win_rate: number;
  trades_7d: number;
  account_value: number;
}): number {
  let score = 0;
  
  // PnL contribution (0-40 points)
  if (analysis.pnl_7d >= 100000) score += 40;
  else if (analysis.pnl_7d >= 50000) score += 35;
  else if (analysis.pnl_7d >= 25000) score += 30;
  else if (analysis.pnl_7d >= 10000) score += 25;
  else if (analysis.pnl_7d >= 5000) score += 20;
  else if (analysis.pnl_7d >= 0) score += 10;
  else if (analysis.pnl_7d >= -5000) score += 5;
  
  // Win rate contribution (0-35 points)
  if (analysis.win_rate >= 0.70) score += 35;
  else if (analysis.win_rate >= 0.60) score += 30;
  else if (analysis.win_rate >= 0.55) score += 25;
  else if (analysis.win_rate >= 0.50) score += 20;
  else if (analysis.win_rate >= 0.45) score += 15;
  else if (analysis.win_rate >= 0.40) score += 10;
  
  // Activity contribution (0-15 points)
  if (analysis.trades_7d >= 50) score += 15;
  else if (analysis.trades_7d >= 20) score += 12;
  else if (analysis.trades_7d >= 10) score += 9;
  else if (analysis.trades_7d >= 5) score += 6;
  else if (analysis.trades_7d >= 1) score += 3;
  
  // Account value contribution (0-10 points)
  if (analysis.account_value >= 1000000) score += 10;
  else if (analysis.account_value >= 500000) score += 8;
  else if (analysis.account_value >= 100000) score += 6;
  else if (analysis.account_value >= 50000) score += 4;
  else if (analysis.account_value >= 10000) score += 2;
  
  return score;
}

function determineQualityTier(pnl_7d: number, win_rate: number, trades_7d: number): 'elite' | 'good' | 'weak' {
  // Must have some trading activity
  if (trades_7d < 1) return 'weak';
  
  // Elite: $25k+ PnL AND 50%+ win rate
  if (pnl_7d >= config.quality.elite.minPnl7d && win_rate >= config.quality.elite.minWinRate) {
    return 'elite';
  }
  
  // Good: Break-even or better AND 45%+ win rate
  if (pnl_7d >= config.quality.good.minPnl7d && win_rate >= config.quality.good.minWinRate) {
    return 'good';
  }
  
  // Also good if great win rate even with slight loss
  if (win_rate >= 0.55 && pnl_7d >= -5000) {
    return 'good';
  }
  
  return 'weak';
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
    
    // Calculate win rate
    const totalTrades = stats7d.wins + stats7d.losses;
    const winRate = totalTrades > 0 ? stats7d.wins / totalTrades : 0;
    
    // Calculate quality score
    const qualityScore = calculateQualityScore({
      pnl_7d: stats7d.pnl,
      win_rate: winRate,
      trades_7d: stats7d.trades,
      account_value: accountValue,
    });
    
    // Determine tier
    const qualityTier = determineQualityTier(stats7d.pnl, winRate, stats7d.trades);
    
    // Is active trader? (has trades in last 7 days OR open positions)
    const isActiveTrader = stats7d.trades > 0 || hasOpenPositions;
    
    return {
      address,
      pnl_7d: stats7d.pnl,
      pnl_30d: stats30d.pnl,
      trades_7d: stats7d.trades,
      wins_7d: stats7d.wins,
      losses_7d: stats7d.losses,
      win_rate: winRate,
      avg_trade_size: stats7d.avgSize,
      account_value: accountValue,
      quality_score: qualityScore,
      quality_tier: qualityTier,
      is_active_trader: isActiveTrader,
      has_open_positions: hasOpenPositions,
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
  
  // Upsert trader_quality
  await db.client
    .from('trader_quality')
    .upsert({
      address: analysis.address,
      pnl_7d: analysis.pnl_7d,
      pnl_30d: analysis.pnl_30d,
      trades_7d: analysis.trades_7d,
      wins_7d: analysis.wins_7d,
      losses_7d: analysis.losses_7d,
      win_rate: analysis.win_rate,
      avg_trade_size: analysis.avg_trade_size,
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
  
  logger.info(`Starting analysis of ${total} holders...`);
  
  // Process in batches
  for (let i = 0; i < holders.length; i += config.analysis.batchSize) {
    const batch = holders.slice(i, i + config.analysis.batchSize);
    
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
      onProgress(Math.min(i + config.analysis.batchSize, total), total);
    }
    
    // Rate limiting delay
    await new Promise(resolve => setTimeout(resolve, config.analysis.batchDelayMs));
    
    // Log progress every 100
    if ((i + config.analysis.batchSize) % 100 === 0 || i + config.analysis.batchSize >= total) {
      const pct = Math.round(((i + config.analysis.batchSize) / total) * 100);
      logger.info(`Progress: ${Math.min(i + config.analysis.batchSize, total)}/${total} (${pct}%) - Elite: ${elite}, Good: ${good}, Weak: ${weak}`);
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