// Alpha Detector - Find skilled traders from trade stream based on closedPnl

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';

const logger = createLogger('processors:alpha-detector');

// In-memory aggregation buffer
const walletBuffer = new Map<string, WalletBuffer>();
const FLUSH_INTERVAL = 30000; // Flush to DB every 30 seconds

interface WalletBuffer {
  address: string;
  wins: number;
  losses: number;
  totalWinAmount: number;
  totalLossAmount: number;
  largestWin: number;
  largestLoss: number;
  totalPnl: number;
  tradeCount: number;
  lastTradeAt: Date;
  coins: Set<string>;
}

/**
 * Process a trade from the stream
 */
export function processTradeForAlpha(trade: {
  wallet: string;
  coin: string;
  side: string;
  price: number;
  size: number;
  closedPnl: number;
  timestamp: Date;
}): void {
  const address = trade.wallet.toLowerCase();
  const pnl = trade.closedPnl || 0;

  // Get or create buffer entry
  let buffer = walletBuffer.get(address);
  if (!buffer) {
    buffer = {
      address,
      wins: 0,
      losses: 0,
      totalWinAmount: 0,
      totalLossAmount: 0,
      largestWin: 0,
      largestLoss: 0,
      totalPnl: 0,
      tradeCount: 0,
      lastTradeAt: trade.timestamp,
      coins: new Set(),
    };
    walletBuffer.set(address, buffer);
  }

  // Update metrics
  buffer.tradeCount++;
  buffer.lastTradeAt = trade.timestamp;
  buffer.coins.add(trade.coin);
  buffer.totalPnl += pnl;

  // Only count closed trades for win/loss
  if (pnl > 0) {
    buffer.wins++;
    buffer.totalWinAmount += pnl;
    buffer.largestWin = Math.max(buffer.largestWin, pnl);
  } else if (pnl < 0) {
    buffer.losses++;
    buffer.totalLossAmount += Math.abs(pnl);
    buffer.largestLoss = Math.max(buffer.largestLoss, Math.abs(pnl));
  }
}

/**
 * Calculate score for a wallet based on its metrics
 */
function calculateScore(metrics: {
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  tradeCount: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  daysSinceFirstSeen: number;
}): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let score = 0;

  // Win Rate Score (0-25 points)
  // 50% = 0, 60% = 12.5, 70% = 25
  if (metrics.tradeCount >= 5) {
    const winRateScore = Math.max(0, (metrics.winRate - 50) * 1.25);
    breakdown.winRate = Math.min(25, Math.round(winRateScore));
    score += breakdown.winRate;
  }

  // Profit Factor Score (0-25 points)
  // 1.0 = 0, 1.5 = 12.5, 2.0+ = 25
  if (metrics.profitFactor > 0) {
    const pfScore = Math.max(0, (metrics.profitFactor - 1) * 25);
    breakdown.profitFactor = Math.min(25, Math.round(pfScore));
    score += breakdown.profitFactor;
  }

  // Total PnL Score (0-20 points)
  // Log scale: $100 = 5, $1000 = 10, $10000 = 15, $100000 = 20
  if (metrics.totalPnl > 0) {
    const pnlScore = Math.log10(metrics.totalPnl + 1) * 5;
    breakdown.totalPnl = Math.min(20, Math.round(pnlScore));
    score += breakdown.totalPnl;
  } else if (metrics.totalPnl < 0) {
    // Penalty for negative PnL
    const penalty = Math.min(20, Math.log10(Math.abs(metrics.totalPnl) + 1) * 3);
    breakdown.totalPnl = -Math.round(penalty);
    score += breakdown.totalPnl;
  }

  // Consistency Score (0-15 points)
  // Based on avg win vs avg loss ratio
  if (metrics.avgLoss > 0) {
    const riskReward = metrics.avgWin / metrics.avgLoss;
    const consistencyScore = Math.min(15, riskReward * 5);
    breakdown.consistency = Math.round(consistencyScore);
    score += breakdown.consistency;
  }

  // Activity Score (0-10 points)
  // More trades = more reliable signal (up to a point)
  if (metrics.tradeCount >= 3) {
    const activityScore = Math.min(10, Math.log10(metrics.tradeCount) * 5);
    breakdown.activity = Math.round(activityScore);
    score += breakdown.activity;
  }

  // Fresh Wallet Bonus (0-5 points)
  // New wallet with good performance
  if (metrics.daysSinceFirstSeen <= 7 && metrics.totalPnl > 0 && metrics.winRate > 55) {
    breakdown.freshBonus = 5;
    score += 5;
  }

  // Clamp score 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, breakdown };
}

/**
 * Flush buffered data to database
 */
export async function flushAlphaBuffer(): Promise<void> {
  if (walletBuffer.size === 0) return;

  const walletsToUpdate = Array.from(walletBuffer.values());
  walletBuffer.clear();

  logger.info(`Flushing ${walletsToUpdate.length} wallets to database`);

  for (const buffer of walletsToUpdate) {
    try {
      // First, get or create wallet
      const { data: existing } = await db.client
        .from('wallets')
        .select('*')
        .eq('address', buffer.address)
        .single();

      // Calculate cumulative metrics
      const wins = (existing?.win_count || 0) + buffer.wins;
      const losses = (existing?.loss_count || 0) + buffer.losses;
      const totalTrades = wins + losses;
      const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

      const totalWinAmount = (existing?.avg_win || 0) * (existing?.win_count || 0) + buffer.totalWinAmount;
      const totalLossAmount = (existing?.avg_loss || 0) * (existing?.loss_count || 0) + buffer.totalLossAmount;
      
      const avgWin = wins > 0 ? totalWinAmount / wins : 0;
      const avgLoss = losses > 0 ? totalLossAmount / losses : 0;
      const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount > 0 ? 999 : 0;

      const realizedPnl = (existing?.realized_pnl || 0) + buffer.totalPnl;
      const largestWin = Math.max(existing?.largest_win || 0, buffer.largestWin);
      const largestLoss = Math.max(existing?.largest_loss || 0, buffer.largestLoss);

      const firstSeenAt = existing?.first_seen_at || new Date();
      const daysSinceFirstSeen = (Date.now() - new Date(firstSeenAt).getTime()) / (1000 * 60 * 60 * 24);

      // Calculate score
      const { score, breakdown } = calculateScore({
        winRate,
        profitFactor,
        totalPnl: realizedPnl,
        tradeCount: totalTrades,
        avgWin,
        avgLoss,
        largestWin,
        largestLoss,
        daysSinceFirstSeen,
      });

      // Upsert wallet
      const { error } = await db.client
        .from('wallets')
        .upsert({
          address: buffer.address,
          win_count: wins,
          loss_count: losses,
          total_trades: totalTrades,
          win_rate: winRate,
          avg_win: avgWin,
          avg_loss: avgLoss,
          profit_factor: profitFactor,
          realized_pnl: realizedPnl,
          total_pnl: realizedPnl,
          largest_win: largestWin,
          largest_loss: largestLoss,
          score: score,
          score_breakdown: breakdown,
          last_trade_at: buffer.lastTradeAt.toISOString(),
          first_seen_at: firstSeenAt,
          is_tracked: true,
        }, { onConflict: 'address' });

      if (error) {
        logger.error(`Failed to upsert wallet ${buffer.address}`, error);
      }
    } catch (error) {
      logger.error(`Error processing wallet ${buffer.address}`, error);
    }
  }

  logger.info('Alpha buffer flush complete');
}

/**
 * Get top wallets by score
 */
export async function getTopAlphaWallets(limit: number = 50): Promise<any[]> {
  const { data, error } = await db.client
    .from('wallets')
    .select('*')
    .gte('total_trades', 5)  // At least 5 trades
    .gt('score', 40)          // Minimum score
    .order('score', { ascending: false })
    .order('realized_pnl', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('Failed to get top alpha wallets', error);
    return [];
  }

  return data || [];
}

/**
 * Start periodic flush
 */
export function startAlphaFlushInterval(): NodeJS.Timeout {
  return setInterval(() => {
    flushAlphaBuffer().catch(err => {
      logger.error('Flush interval error', err);
    });
  }, FLUSH_INTERVAL);
}

export default {
  processTradeForAlpha,
  flushAlphaBuffer,
  getTopAlphaWallets,
  startAlphaFlushInterval,
};