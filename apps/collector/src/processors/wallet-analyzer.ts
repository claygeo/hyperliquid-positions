// Wallet Analyzer - Fetches trade history and calculates quality scores
// Determines which wallets are ELITE, GOOD, or WEAK

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';

const logger = createLogger('wallet-analyzer');

const HYPERLIQUID_API = 'https://api.hyperliquid.xyz/info';
const BATCH_SIZE = 5;
const BATCH_DELAY = 1000;
const ANALYSIS_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Quality tier thresholds
const ELITE_PNL_7D = 25000;      // $25k+ in 7 days
const ELITE_WIN_RATE = 0.50;     // 50%+ win rate
const GOOD_PNL_7D = 0;           // Positive 7d PnL
const GOOD_WIN_RATE = 0.55;      // OR 55%+ win rate
const MIN_TRADES_FOR_ANALYSIS = 3;

interface UserFill {
  coin: string;
  px: string;
  sz: string;
  side: string;
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
}

interface QualityMetrics {
  pnl_7d: number;
  pnl_30d: number;
  win_rate: number;
  total_trades_7d: number;
  total_trades_30d: number;
  avg_trade_pnl: number;
  largest_win: number;
  largest_loss: number;
  quality_score: number;
  quality_tier: 'elite' | 'good' | 'weak';
}

interface WalletRecord {
  address: string;
}

interface ClearinghouseResponse {
  marginSummary?: {
    accountValue: string;
  };
}

async function fetchUserFills(address: string): Promise<UserFill[]> {
  try {
    const response = await fetch(HYPERLIQUID_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'userFills',
        user: address,
      }),
    });
    
    if (!response.ok) {
      logger.warn('Failed to fetch fills for ' + address + ': ' + response.status);
      return [];
    }
    
    const data = await response.json();
    return Array.isArray(data) ? data as UserFill[] : [];
  } catch (error) {
    logger.error('Error fetching fills for ' + address, error);
    return [];
  }
}

async function fetchAccountValue(address: string): Promise<number> {
  try {
    const response = await fetch(HYPERLIQUID_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clearinghouseState',
        user: address,
      }),
    });
    
    if (!response.ok) return 0;
    
    const data = await response.json() as ClearinghouseResponse;
    return parseFloat(data.marginSummary?.accountValue || '0');
  } catch {
    return 0;
  }
}

function calculateMetrics(fills: UserFill[]): QualityMetrics {
  const now = Date.now();
  const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
  
  let pnl_7d = 0;
  let pnl_30d = 0;
  let wins_7d = 0;
  let losses_7d = 0;
  let trades_7d = 0;
  let trades_30d = 0;
  let largest_win = 0;
  let largest_loss = 0;
  
  // Process fills - only count those with closedPnl (actual closed trades)
  for (const fill of fills) {
    const fillTime = fill.time;
    const closedPnl = parseFloat(fill.closedPnl || '0');
    
    // Skip fills with no PnL (not a close)
    if (closedPnl === 0) continue;
    
    // 30-day stats
    if (fillTime >= thirtyDaysAgo) {
      pnl_30d += closedPnl;
      trades_30d++;
    }
    
    // 7-day stats
    if (fillTime >= sevenDaysAgo) {
      pnl_7d += closedPnl;
      trades_7d++;
      
      if (closedPnl > 0) {
        wins_7d++;
        if (closedPnl > largest_win) largest_win = closedPnl;
      } else {
        losses_7d++;
        if (closedPnl < largest_loss) largest_loss = closedPnl;
      }
    }
  }
  
  // Calculate win rate
  const totalTrades7d = wins_7d + losses_7d;
  const win_rate = totalTrades7d > 0 ? wins_7d / totalTrades7d : 0;
  
  // Calculate average trade PnL
  const avg_trade_pnl = trades_7d > 0 ? pnl_7d / trades_7d : 0;
  
  // Calculate quality score (0-100)
  let quality_score = 0;
  
  // PnL contribution (up to 40 points)
  if (pnl_7d >= 100000) quality_score += 40;
  else if (pnl_7d >= 50000) quality_score += 35;
  else if (pnl_7d >= 25000) quality_score += 30;
  else if (pnl_7d >= 10000) quality_score += 25;
  else if (pnl_7d >= 5000) quality_score += 20;
  else if (pnl_7d >= 1000) quality_score += 15;
  else if (pnl_7d > 0) quality_score += 10;
  else if (pnl_7d > -5000) quality_score += 5;
  
  // Win rate contribution (up to 35 points)
  if (win_rate >= 0.70) quality_score += 35;
  else if (win_rate >= 0.60) quality_score += 30;
  else if (win_rate >= 0.55) quality_score += 25;
  else if (win_rate >= 0.50) quality_score += 20;
  else if (win_rate >= 0.45) quality_score += 15;
  else if (win_rate >= 0.40) quality_score += 10;
  
  // Trade volume contribution (up to 15 points)
  if (trades_7d >= 50) quality_score += 15;
  else if (trades_7d >= 30) quality_score += 12;
  else if (trades_7d >= 20) quality_score += 10;
  else if (trades_7d >= 10) quality_score += 8;
  else if (trades_7d >= 5) quality_score += 5;
  else if (trades_7d >= 3) quality_score += 3;
  
  // Consistency bonus (up to 10 points)
  if (pnl_7d > 0 && pnl_30d > 0) quality_score += 10;
  else if (pnl_7d > 0 || pnl_30d > 0) quality_score += 5;
  
  // Determine tier
  let quality_tier: 'elite' | 'good' | 'weak' = 'weak';
  
  if (pnl_7d >= ELITE_PNL_7D && win_rate >= ELITE_WIN_RATE) {
    quality_tier = 'elite';
  } else if (pnl_7d >= GOOD_PNL_7D || win_rate >= GOOD_WIN_RATE) {
    quality_tier = 'good';
  }
  
  return {
    pnl_7d,
    pnl_30d,
    win_rate,
    total_trades_7d: trades_7d,
    total_trades_30d: trades_30d,
    avg_trade_pnl,
    largest_win,
    largest_loss,
    quality_score: Math.min(100, quality_score),
    quality_tier,
  };
}

async function analyzeWallet(address: string): Promise<QualityMetrics | null> {
  // Fetch trade history
  const fills = await fetchUserFills(address);
  
  if (fills.length < MIN_TRADES_FOR_ANALYSIS) {
    return null;
  }
  
  // Calculate metrics
  const metrics = calculateMetrics(fills);
  
  // Fetch account value
  const accountValue = await fetchAccountValue(address);
  
  // Save to database
  const result = await db.client
    .from('trader_quality')
    .upsert({
      address: address.toLowerCase(),
      pnl_7d: metrics.pnl_7d,
      pnl_30d: metrics.pnl_30d,
      win_rate: metrics.win_rate,
      total_trades_7d: metrics.total_trades_7d,
      total_trades_30d: metrics.total_trades_30d,
      avg_trade_pnl: metrics.avg_trade_pnl,
      largest_win: metrics.largest_win,
      largest_loss: metrics.largest_loss,
      account_value: accountValue,
      quality_score: metrics.quality_score,
      quality_tier: metrics.quality_tier,
      is_tracked: metrics.quality_tier !== 'weak',
      last_analyzed_at: new Date().toISOString(),
    }, { onConflict: 'address' });
  
  if (result.error) {
    logger.error('Failed to save quality for ' + address, result.error);
    return null;
  }
  
  // Mark as analyzed in discovered_wallets
  await db.client
    .from('discovered_wallets')
    .update({ needs_analysis: false })
    .eq('address', address.toLowerCase());
  
  return metrics;
}

async function analyzeNewWallets(): Promise<void> {
  // Get wallets that need analysis
  const result = await db.client
    .from('discovered_wallets')
    .select('address')
    .eq('needs_analysis', true)
    .limit(50);
  
  if (result.error || !result.data || result.data.length === 0) {
    return;
  }
  
  const walletData = result.data as WalletRecord[];
  const wallets = walletData.map(w => w.address);
  logger.info('Analyzing ' + wallets.length + ' new wallets...');
  
  let eliteCount = 0;
  let goodCount = 0;
  let weakCount = 0;
  
  // Process in batches
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    
    const results = await Promise.all(
      batch.map(async (address) => {
        const metrics = await analyzeWallet(address);
        return { address, metrics };
      })
    );
    
    for (const { address, metrics } of results) {
      if (!metrics) continue;
      
      if (metrics.quality_tier === 'elite') {
        eliteCount++;
        logger.info('ELITE: ' + address.slice(0, 10) + '... | 7d: $' + Math.round(metrics.pnl_7d) + ' | WR: ' + (metrics.win_rate * 100).toFixed(1) + '%');
      } else if (metrics.quality_tier === 'good') {
        goodCount++;
        logger.info('GOOD: ' + address.slice(0, 10) + '... | 7d: $' + Math.round(metrics.pnl_7d) + ' | WR: ' + (metrics.win_rate * 100).toFixed(1) + '%');
      } else {
        weakCount++;
      }
    }
    
    // Delay between batches
    if (i + BATCH_SIZE < wallets.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
    }
  }
  
  logger.info('Analysis complete | Elite: ' + eliteCount + ' | Good: ' + goodCount + ' | Weak: ' + weakCount);
}

async function reanalyzeTrackedWallets(): Promise<void> {
  // Re-analyze wallets we're tracking (their stats may have changed)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  
  const result = await db.client
    .from('trader_quality')
    .select('address')
    .eq('is_tracked', true)
    .lt('last_analyzed_at', oneHourAgo)
    .limit(20);
  
  if (result.error || !result.data || result.data.length === 0) {
    return;
  }
  
  const walletData = result.data as WalletRecord[];
  const wallets = walletData.map(w => w.address);
  logger.info('Re-analyzing ' + wallets.length + ' tracked wallets...');
  
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(address => analyzeWallet(address)));
    
    if (i + BATCH_SIZE < wallets.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
    }
  }
}

let analysisInterval: NodeJS.Timeout | null = null;

export function startWalletAnalyzer(): void {
  logger.info('Starting wallet analyzer...');
  logger.info('Elite threshold: $' + ELITE_PNL_7D + ' 7d PnL AND ' + (ELITE_WIN_RATE * 100) + '% win rate');
  logger.info('Good threshold: $' + GOOD_PNL_7D + '+ 7d PnL OR ' + (GOOD_WIN_RATE * 100) + '% win rate');
  
  // Run initial analysis
  analyzeNewWallets();
  
  // Run periodically
  analysisInterval = setInterval(async () => {
    await analyzeNewWallets();
    await reanalyzeTrackedWallets();
  }, ANALYSIS_INTERVAL);
}

export function stopWalletAnalyzer(): void {
  if (analysisInterval) {
    clearInterval(analysisInterval);
    analysisInterval = null;
  }
  logger.info('Wallet analyzer stopped');
}

export async function getQualityStats(): Promise<{ elite: number; good: number; tracked: number }> {
  const eliteResult = await db.client
    .from('trader_quality')
    .select('address', { count: 'exact' })
    .eq('quality_tier', 'elite');
  
  const goodResult = await db.client
    .from('trader_quality')
    .select('address', { count: 'exact' })
    .eq('quality_tier', 'good');
  
  const trackedResult = await db.client
    .from('trader_quality')
    .select('address', { count: 'exact' })
    .eq('is_tracked', true);
  
  return {
    elite: eliteResult.count || 0,
    good: goodResult.count || 0,
    tracked: trackedResult.count || 0,
  };
}

export { analyzeWallet, analyzeNewWallets };
export default { startWalletAnalyzer, stopWalletAnalyzer, getQualityStats };