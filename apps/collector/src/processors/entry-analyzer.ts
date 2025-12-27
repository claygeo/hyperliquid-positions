// Entry analyzer - track price movement after trade entries

import { HyperliquidClient } from '@hyperliquid-tracker/sdk';
import { calculateEntryScore, SCORING_THRESHOLDS } from '@hyperliquid-tracker/shared';
import { createLogger } from '../utils/logger.js';
import { metrics, trackTiming } from '../utils/metrics.js';
import CONFIG from '../config.js';
import { getTradesNeedingPriceBackfill, updateTradeEntryScores } from '../db/trades.js';

const logger = createLogger('processor:entry');

// Price cache to avoid repeated API calls
const priceCache: Map<string, Map<number, number>> = new Map();
const CACHE_BUCKET_MS = 60000; // 1 minute buckets

/**
 * Analyze entries and calculate entry scores
 */
export async function analyzeEntries(limit = 200): Promise<number> {
  return trackTiming('analyze_entries', async () => {
    try {
      const trades = await getTradesNeedingPriceBackfill(limit);
      
      if (trades.length === 0) {
        logger.debug('No trades need entry analysis');
        return 0;
      }

      logger.info(`Analyzing entries for ${trades.length} trades`);

      const client = new HyperliquidClient({
        apiUrl: CONFIG.hyperliquid.apiUrl,
      });

      // Get current prices for all coins
      const currentMids = await client.getAllMids();
      
      const updates: {
        id: number;
        price_5m_later?: number;
        price_1h_later?: number;
        price_4h_later?: number;
        entry_score?: number;
      }[] = [];

      const now = Date.now();

      for (const trade of trades) {
        const tradeTime = new Date(trade.timestamp).getTime();
        const timeSinceEntry = now - tradeTime;

        // Get the current price for this coin
        const currentPrice = currentMids[trade.coin]
          ? parseFloat(currentMids[trade.coin])
          : null;

        if (!currentPrice) continue;

        const update: typeof updates[0] = { id: trade.id };

        // Check 5 minute mark
        if (
          timeSinceEntry >= SCORING_THRESHOLDS.ENTRY_SCORE_5M &&
          trade.price_5m_later === null
        ) {
          // For older trades, use current price as approximation
          // In production, you'd fetch historical prices
          update.price_5m_later = currentPrice;
        }

        // Check 1 hour mark
        if (
          timeSinceEntry >= SCORING_THRESHOLDS.ENTRY_SCORE_1H &&
          trade.price_1h_later === null
        ) {
          update.price_1h_later = currentPrice;
        }

        // Check 4 hour mark
        if (
          timeSinceEntry >= SCORING_THRESHOLDS.ENTRY_SCORE_4H &&
          trade.price_4h_later === null
        ) {
          update.price_4h_later = currentPrice;
        }

        // Calculate entry score if we have enough data
        if (update.price_5m_later || trade.price_5m_later) {
          const price5m = update.price_5m_later || trade.price_5m_later!;
          const price1h = update.price_1h_later || trade.price_1h_later;
          const price4h = update.price_4h_later || trade.price_4h_later;

          // Weighted average of timeframes
          const scores: number[] = [];
          const weights: number[] = [];

          // 5 minute score (lowest weight)
          scores.push(calculateEntryScore(trade.side, trade.price, price5m));
          weights.push(0.2);

          // 1 hour score (medium weight)
          if (price1h) {
            scores.push(calculateEntryScore(trade.side, trade.price, price1h));
            weights.push(0.3);
          }

          // 4 hour score (highest weight)
          if (price4h) {
            scores.push(calculateEntryScore(trade.side, trade.price, price4h));
            weights.push(0.5);
          }

          // Calculate weighted average
          const totalWeight = weights.reduce((a, b) => a + b, 0);
          const weightedSum = scores.reduce((sum, score, i) => sum + score * weights[i], 0);
          update.entry_score = weightedSum / totalWeight;
        }

        if (Object.keys(update).length > 1) {
          updates.push(update);
        }
      }

      if (updates.length > 0) {
        await updateTradeEntryScores(updates);
        metrics.increment('entries_analyzed', updates.length);
        logger.info(`Updated entry scores for ${updates.length} trades`);
      }

      return updates.length;
    } catch (error) {
      logger.error('Error analyzing entries', error);
      return 0;
    }
  });
}

/**
 * Get cached price or fetch from API
 */
async function getCachedPrice(
  client: HyperliquidClient,
  coin: string,
  timestamp: number
): Promise<number | null> {
  const bucket = Math.floor(timestamp / CACHE_BUCKET_MS) * CACHE_BUCKET_MS;
  
  let coinCache = priceCache.get(coin);
  if (!coinCache) {
    coinCache = new Map();
    priceCache.set(coin, coinCache);
  }

  if (coinCache.has(bucket)) {
    return coinCache.get(bucket)!;
  }

  // For now, return null - in production you'd fetch from candle data
  return null;
}

/**
 * Clear old price cache entries
 */
export function clearOldCache(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [coin, coinCache] of priceCache) {
    for (const [bucket] of coinCache) {
      if (bucket < cutoff) {
        coinCache.delete(bucket);
      }
    }
    if (coinCache.size === 0) {
      priceCache.delete(coin);
    }
  }
}

export default { analyzeEntries, clearOldCache };
