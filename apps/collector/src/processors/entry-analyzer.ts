// Entry timing analyzer

import { createLogger } from '../utils/logger.js';
import { getTradesNeedingPriceBackfill, updateTradeEntryScore } from '../db/trades.js';
import type { DBTrade } from '@hyperliquid-tracker/shared';

const logger = createLogger('processors:entry-analyzer');

// Cache for price data
const priceCache = new Map<string, Map<number, number>>();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

/**
 * Analyze entry quality for trades
 * @returns number of trades analyzed
 */
export async function analyzeEntries(limit: number = 100): Promise<number> {
  logger.info('Starting entry analysis');

  try {
    const trades = await getTradesNeedingPriceBackfill(limit);

    if (trades.length === 0) {
      logger.debug('No trades need entry analysis');
      return 0;
    }

    let analyzed = 0;
    let failed = 0;

    for (const trade of trades) {
      try {
        const score = await analyzeTradeEntry(trade);
        if (score !== null) {
          analyzed++;
        } else {
          failed++;
        }
      } catch (error) {
        logger.error(`Failed to analyze trade ${trade.id}`, error);
        failed++;
      }
    }

    logger.info('Entry analysis complete', { analyzed, failed });
    return analyzed;
  } catch (error) {
    logger.error('Entry analysis failed', error);
    throw error;
  }
}

/**
 * Analyze a single trade's entry quality
 */
async function analyzeTradeEntry(trade: DBTrade): Promise<number | null> {
  const entryPrice = trade.price;

  // Calculate basic entry score based on trade characteristics
  let score = 0.5; // Base score

  // Adjust based on trade size (larger trades = more conviction)
  if (trade.size > 10000) score += 0.1;
  if (trade.size > 50000) score += 0.1;

  // Clamp score between 0 and 1
  score = Math.max(0, Math.min(1, score));

  // Update the trade
  await updateTradeEntryScore(
    trade.id,
    score,
    entryPrice,
    null,
    null
  );

  return score;
}

/**
 * Clear old cache entries
 */
export function clearOldCache(): void {
  const now = Date.now();
  for (const [coin, timeMap] of priceCache.entries()) {
    for (const [time] of timeMap.entries()) {
      if (now - time > CACHE_DURATION) {
        timeMap.delete(time);
      }
    }
    if (timeMap.size === 0) {
      priceCache.delete(coin);
    }
  }
}

export default { analyzeEntries, clearOldCache };