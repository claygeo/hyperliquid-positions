// Wallet scorer - calculate and update wallet scores

import {
  buildWalletScore,
  calculateTotalVolume,
  SCORING_THRESHOLDS,
} from '@hyperliquid-tracker/shared';
import type { DBWallet, DBWalletUpdate } from '@hyperliquid-tracker/shared';
import { createLogger } from '../utils/logger.js';
import { metrics, trackTiming } from '../utils/metrics.js';
import { getWalletsForScoring, updateWallet } from '../db/wallets.js';
import { getTradesForScoring } from '../db/trades.js';

const logger = createLogger('processor:scorer');

/**
 * Score a single wallet based on their trade history
 */
export async function scoreWallet(address: string): Promise<DBWalletUpdate | null> {
  try {
    const trades = await getTradesForScoring(address, 500);
    
    if (trades.length < SCORING_THRESHOLDS.MIN_TRADES_FOR_SCORE) {
      logger.debug(`Wallet ${address.slice(0, 10)} has insufficient trades for scoring`);
      return null;
    }

    // Build score from trades
    const score = buildWalletScore(
      address,
      trades.map(t => ({
        closedPnl: t.closed_pnl,
        entryScore: t.entry_score,
      }))
    );

    // Calculate additional stats
    const totalVolume = calculateTotalVolume(
      trades.map(t => ({ size: t.size, price: t.price }))
    );

    // Calculate average hold time (simplified)
    let avgHoldMinutes: number | null = null;
    const closedTrades = trades.filter(t => t.closed_pnl !== null);
    if (closedTrades.length >= 2) {
      // Rough estimate based on trade frequency
      const firstTrade = new Date(closedTrades[closedTrades.length - 1].timestamp);
      const lastTrade = new Date(closedTrades[0].timestamp);
      const totalMinutes = (lastTrade.getTime() - firstTrade.getTime()) / 60000;
      avgHoldMinutes = totalMinutes / closedTrades.length;
    }

    const update: DBWalletUpdate = {
      total_trades: trades.length,
      total_volume: totalVolume,
      win_rate: score.components.winRate,
      entry_score: score.components.entryQuality,
      risk_adjusted_return: score.components.riskAdjusted,
      avg_hold_minutes: avgHoldMinutes,
      funding_efficiency: score.components.fundingEfficiency,
      overall_score: score.overall,
    };

    await updateWallet(address, update);
    
    logger.debug(`Scored wallet ${address.slice(0, 10)}`, {
      score: score.overall.toFixed(3),
      trades: trades.length,
    });

    return update;
  } catch (error) {
    logger.error(`Error scoring wallet ${address}`, error);
    return null;
  }
}

/**
 * Score multiple wallets that need updating
 */
export async function scoreWallets(limit = 100): Promise<number> {
  return trackTiming('score_wallets', async () => {
    try {
      const wallets = await getWalletsForScoring(
        SCORING_THRESHOLDS.MIN_TRADES_FOR_SCORE,
        limit
      );

      if (wallets.length === 0) {
        logger.debug('No wallets need scoring');
        return 0;
      }

      logger.info(`Scoring ${wallets.length} wallets`);

      let scored = 0;
      let errors = 0;

      for (const wallet of wallets) {
        const result = await scoreWallet(wallet.address);
        if (result) {
          scored++;
        } else {
          errors++;
        }

        // Small delay to avoid overwhelming the database
        await delay(50);
      }

      metrics.increment('wallets_scored', scored);
      metrics.increment('wallet_score_errors', errors);
      
      logger.info(`Scoring complete: ${scored} scored, ${errors} errors`);
      return scored;
    } catch (error) {
      logger.error('Error in scoreWallets', error);
      return 0;
    }
  });
}

/**
 * Get top wallets by score
 */
export async function getTopWallets(wallets: DBWallet[], limit = 50): DBWallet[] {
  return wallets
    .filter(w => w.overall_score !== null)
    .sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0))
    .slice(0, limit);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default { scoreWallet, scoreWallets, getTopWallets };
