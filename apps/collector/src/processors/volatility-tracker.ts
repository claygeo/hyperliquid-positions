// Volatility Tracker V4
// Calculates and caches ATR for volatility-adjusted stop losses
// FIXED: Batched requests with longer delays to avoid rate limiting

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import hyperliquid from '../utils/hyperliquid-api.js';
import { config } from '../config.js';

const logger = createLogger('volatility-tracker');

// ============================================
// Types
// ============================================

interface CoinVolatility {
  coin: string;
  atr14d: number;
  atr7d: number;
  dailyRangeAvg: number;
  volatilityRank: number;
  lastPrice: number;
  priceChange24hPct: number;
}

// In-memory cache for fast lookups
const volatilityCache = new Map<string, CoinVolatility>();
let lastCacheUpdate: Date | null = null;

// ============================================
// Core Functions
// ============================================

/**
 * Calculate volatility for a single coin
 */
async function calculateCoinVolatility(coin: string): Promise<CoinVolatility | null> {
  try {
    // Add delay before each API call
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const atr14Result = await hyperliquid.calculateATR(coin, 14);
    if (!atr14Result) return null;

    // Use same candle data for 7d ATR estimate (avoid extra API call)
    const atr7d = atr14Result.atr * 1.1; // Rough estimate - shorter period = slightly higher

    // Estimate daily range from ATR
    const dailyRangeAvg = atr14Result.atrPct;

    // Get current price from mids (batched call, not per-coin)
    const mids = await hyperliquid.getAllMids();
    const lastPrice = mids[coin] ? parseFloat(mids[coin]) : 0;

    const volatility: CoinVolatility = {
      coin,
      atr14d: atr14Result.atr,
      atr7d,
      dailyRangeAvg,
      volatilityRank: 0,
      lastPrice,
      priceChange24hPct: 0,
    };

    return volatility;
  } catch (error) {
    logger.error(`Failed to calculate volatility for ${coin}`, error);
    return null;
  }
}

/**
 * Update volatility for coins that are actually in trader positions
 * Only updates coins we care about, not all 100+ coins
 */
export async function updateAllVolatility(): Promise<void> {
  try {
    // Get coins from active positions only (not all coins)
    const { data: positions } = await db.client
      .from('trader_positions')
      .select('coin')
      .limit(500);

    const coinsFromPositions = new Set(positions?.map(p => p.coin) || []);

    // Add major coins we always want
    const majorCoins = ['BTC', 'ETH', 'SOL', 'HYPE'];
    for (const coin of majorCoins) {
      coinsFromPositions.add(coin);
    }

    const allCoins = Array.from(coinsFromPositions);
    
    // Limit to 20 coins max per cycle to avoid rate limiting
    const coinsToUpdate = allCoins.slice(0, 20);
    
    logger.info(`Updating volatility for ${coinsToUpdate.length} coins (of ${allCoins.length} total)...`);

    const volatilities: CoinVolatility[] = [];

    for (const coin of coinsToUpdate) {
      const vol = await calculateCoinVolatility(coin);
      if (vol) {
        volatilities.push(vol);
      }
      // Long delay between coins to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    if (volatilities.length === 0) {
      logger.warn('No volatility data calculated');
      return;
    }

    // Calculate volatility ranks
    volatilities.sort((a, b) => a.dailyRangeAvg - b.dailyRangeAvg);
    for (let i = 0; i < volatilities.length; i++) {
      volatilities[i].volatilityRank = Math.round((i / Math.max(1, volatilities.length - 1)) * 100);
    }

    // Save to database
    for (const vol of volatilities) {
      await db.client.from('coin_volatility').upsert({
        coin: vol.coin,
        atr_14d: vol.atr14d,
        atr_7d: vol.atr7d,
        daily_range_avg: vol.dailyRangeAvg,
        volatility_rank: vol.volatilityRank,
        last_price: vol.lastPrice,
        price_change_24h_pct: vol.priceChange24hPct,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'coin' });

      volatilityCache.set(vol.coin, vol);
    }

    lastCacheUpdate = new Date();
    logger.info(`Volatility updated for ${volatilities.length} coins`);

  } catch (error) {
    logger.error('Failed to update volatility', error);
  }
}

/**
 * Get volatility data for a coin (from cache/DB only, no API calls)
 */
export async function getVolatility(coin: string): Promise<CoinVolatility | null> {
  // Check cache first
  const cached = volatilityCache.get(coin);
  if (cached && lastCacheUpdate && (Date.now() - lastCacheUpdate.getTime()) < 4 * 60 * 60 * 1000) {
    return cached;
  }

  // Check database
  const { data } = await db.client
    .from('coin_volatility')
    .select('*')
    .eq('coin', coin)
    .single();

  if (data) {
    const vol: CoinVolatility = {
      coin: data.coin,
      atr14d: parseFloat(data.atr_14d || '0'),
      atr7d: parseFloat(data.atr_7d || '0'),
      dailyRangeAvg: parseFloat(data.daily_range_avg || '0'),
      volatilityRank: data.volatility_rank || 50,
      lastPrice: parseFloat(data.last_price || '0'),
      priceChange24hPct: parseFloat(data.price_change_24h_pct || '0'),
    };
    volatilityCache.set(coin, vol);
    return vol;
  }

  // Return default if not found (don't make API call here)
  return null;
}

/**
 * Calculate volatility-adjusted stop loss using CACHED data only
 */
export async function calculateVolatilityAdjustedStop(
  coin: string,
  direction: 'long' | 'short',
  entryPrice: number,
  atrMultiple: number = 1.5
): Promise<{
  stopLoss: number;
  stopDistancePct: number;
  atr: number;
  volatilityRank: number;
}> {
  const vol = await getVolatility(coin);

  // Default to 3% if no volatility data
  if (!vol || !vol.atr14d) {
    const defaultStopPct = 3;
    const defaultStop = direction === 'long' 
      ? entryPrice * (1 - defaultStopPct / 100)
      : entryPrice * (1 + defaultStopPct / 100);
    return {
      stopLoss: defaultStop,
      stopDistancePct: defaultStopPct,
      atr: 0,
      volatilityRank: 50,
    };
  }

  // Calculate stop distance based on ATR
  const atrDistance = vol.atr14d * atrMultiple;
  const stopDistancePct = (atrDistance / entryPrice) * 100;

  // Apply bounds
  const minStopPct = config.volatility?.minStopPct || 1;
  const maxStopPct = config.volatility?.maxStopPct || 10;
  const boundedStopPct = Math.max(minStopPct, Math.min(maxStopPct, stopDistancePct));

  const stopLoss = direction === 'long'
    ? entryPrice * (1 - boundedStopPct / 100)
    : entryPrice * (1 + boundedStopPct / 100);

  return {
    stopLoss,
    stopDistancePct: boundedStopPct,
    atr: vol.atr14d,
    volatilityRank: vol.volatilityRank,
  };
}

/**
 * Get coins by volatility
 */
export async function getCoinsByVolatility(
  minRank?: number,
  maxRank?: number
): Promise<CoinVolatility[]> {
  const { data } = await db.client
    .from('coin_volatility')
    .select('*')
    .gte('volatility_rank', minRank || 0)
    .lte('volatility_rank', maxRank || 100)
    .order('volatility_rank', { ascending: false });

  if (!data) return [];

  return data.map(d => ({
    coin: d.coin,
    atr14d: parseFloat(d.atr_14d || '0'),
    atr7d: parseFloat(d.atr_7d || '0'),
    dailyRangeAvg: parseFloat(d.daily_range_avg || '0'),
    volatilityRank: d.volatility_rank || 50,
    lastPrice: parseFloat(d.last_price || '0'),
    priceChange24hPct: parseFloat(d.price_change_24h_pct || '0'),
  }));
}

export async function getMostVolatileCoins(limit: number = 10): Promise<CoinVolatility[]> {
  return getCoinsByVolatility(75, 100).then(coins => coins.slice(0, limit));
}

export async function getLeastVolatileCoins(limit: number = 10): Promise<CoinVolatility[]> {
  const { data } = await db.client
    .from('coin_volatility')
    .select('*')
    .order('volatility_rank', { ascending: true })
    .limit(limit);

  if (!data) return [];

  return data.map(d => ({
    coin: d.coin,
    atr14d: parseFloat(d.atr_14d || '0'),
    atr7d: parseFloat(d.atr_7d || '0'),
    dailyRangeAvg: parseFloat(d.daily_range_avg || '0'),
    volatilityRank: d.volatility_rank || 50,
    lastPrice: parseFloat(d.last_price || '0'),
    priceChange24hPct: parseFloat(d.price_change_24h_pct || '0'),
  }));
}

// ============================================
// Polling Loop
// ============================================

let volatilityInterval: NodeJS.Timeout | null = null;

export function startVolatilityTracker(): void {
  logger.info('Starting volatility tracker...');
  
  // Initial update after 30 seconds (let other things start first)
  setTimeout(updateAllVolatility, 30 * 1000);
  
  // Update every 4 hours (was 2 hours - reduced frequency)
  volatilityInterval = setInterval(updateAllVolatility, 4 * 60 * 60 * 1000);
}

export function stopVolatilityTracker(): void {
  if (volatilityInterval) {
    clearInterval(volatilityInterval);
    volatilityInterval = null;
  }
  logger.info('Volatility tracker stopped');
}

export default {
  startVolatilityTracker,
  stopVolatilityTracker,
  calculateCoinVolatility,
  updateAllVolatility,
  getVolatility,
  calculateVolatilityAdjustedStop,
  getCoinsByVolatility,
  getMostVolatileCoins,
  getLeastVolatileCoins,
};