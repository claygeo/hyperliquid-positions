// Wallet scoring processor

import { createLogger } from '../utils/logger.js';
import { getWalletsForScoring, updateWallet } from '../db/wallets.js';
import { getTradesForScoring } from '../db/trades.js';
import {
  calculateWinRate,
  calculateAvgEntryScore,
  calculateRiskAdjustedReturn,
  calculateConsistency,
  calculateOverallScore,
  SCORING_WEIGHTS,
} from '@hyperliquid-tracker/shared';
import type { DBWallet } from '@hyperliquid-tracker/shared';

const logger = createLogger('processors:wallet-scorer');

interface TradeForScoring {
  wallet: string;
  closed_pnl: number | null;
  entry_score: number | null;
  size: number;
  timestamp: string;
}

/**
 * Score a single wallet based on their trading history
 */
export async function scoreWallet(address: string): Promise<number | null> {
  try {
    const trades = await getTradesForScoring(address);
    
    if (trades.length < 20) {
      logger.debug(`Insufficient trades for ${address}: ${trades.length}`);
      return null;
    }

    const winRate = calculateWinRateFromTrades(trades);
    const entryScore = calculateEntryScoreFromTrades(trades);
    const riskAdjusted = calculateRiskAdjustedFromTrades(trades);
    const consistency = calculateConsistencyFromTrades(trades);
    
    // Funding efficiency placeholder (would need funding data)
    const fundingEfficiency = 0.5;

    const overallScore = calculateOverallScore({
      winRate,
      entryScore,
      riskAdjusted,
      consistency,
      fundingEfficiency,
    });

    // Update wallet with new scores
    await updateWallet(address, {
      win_rate: winRate,
      entry_score: entryScore,
      risk_adjusted_return: riskAdjusted,
      consistency_score: consistency,
      overall_score: overallScore,
    });

    logger.debug(`Scored wallet ${address}: ${overallScore.toFixed(3)}`);
    return overallScore;
  } catch (error) {
    logger.error(`Error scoring wallet ${address}:`, error);
    return null;
  }
}

/**
 * Score all eligible wallets
 */
export async function scoreAllWallets(): Promise<void> {
  try {
    const wallets = await getWalletsForScoring();
    logger.info(`Scoring ${wallets.length} wallets`);

    let scored = 0;
    let failed = 0;

    for (const wallet of wallets) {
      const score = await scoreWallet(wallet.address);
      if (score !== null) {
        scored++;
      } else {
        failed++;
      }
    }

    logger.info(`Scoring complete: ${scored} scored, ${failed} skipped`);
  } catch (error) {
    logger.error('Error in scoreAllWallets:', error);
    throw error;
  }
}

/**
 * Get top wallets by score
 */
export async function getTopWallets(limit: number = 100): Promise<DBWallet[]> {
  const wallets = await getWalletsForScoring();
  return wallets
    .filter(w => w.overall_score !== null)
    .sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0))
    .slice(0, limit);
}

// Helper functions

function calculateWinRateFromTrades(trades: TradeForScoring[]): number {
  const closedTrades = trades.filter(t => t.closed_pnl !== null);
  if (closedTrades.length === 0) return 0.5;
  
  const wins = closedTrades.filter(t => (t.closed_pnl || 0) > 0).length;
  return wins / closedTrades.length;
}

function calculateEntryScoreFromTrades(trades: TradeForScoring[]): number {
  const scoredTrades = trades.filter(t => t.entry_score !== null);
  if (scoredTrades.length === 0) return 0;
  
  const sum = scoredTrades.reduce((acc, t) => acc + (t.entry_score || 0), 0);
  return sum / scoredTrades.length;
}

function calculateRiskAdjustedFromTrades(trades: TradeForScoring[]): number {
  const closedTrades = trades.filter(t => t.closed_pnl !== null);
  if (closedTrades.length === 0) return 0;
  
  const pnls = closedTrades.map(t => t.closed_pnl || 0);
  const avgPnl = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((acc, p) => acc + Math.pow(p - avgPnl, 2), 0) / pnls.length;
  const stdDev = Math.sqrt(variance);
  
  if (stdDev === 0) return avgPnl > 0 ? 1 : 0;
  return avgPnl / stdDev; // Sharpe-like ratio
}

function calculateConsistencyFromTrades(trades: TradeForScoring[]): number {
  if (trades.length < 2) return 0.5;
  
  // Group by day and check for consistent activity
  const days = new Set(trades.map(t => t.timestamp.split('T')[0]));
  const totalDays = Math.ceil(
    (new Date(trades[0].timestamp).getTime() - new Date(trades[trades.length - 1].timestamp).getTime()) 
    / (1000 * 60 * 60 * 24)
  ) || 1;
  
  return Math.min(days.size / totalDays, 1);
}

export default { scoreWallet, scoreAllWallets, getTopWallets };