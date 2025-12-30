// Volatility Tracker V4
// Calculates and caches ATR for volatility-adjusted stop losses
// Prevents tight stops on volatile assets, loose stops on stable assets

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import hyperliquid from '../utils/hyperliquid-api.js';

const logger = createLogger('volatility-tracker');

// ============================================
// Types
// ============================================

interface CoinVolatility {
  coin: string;
  atr14d: number;
  atr7d: number;
  dailyRangeAvg: number;
  volatilityRank: number; // 1-100
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
export async function calculateCoinVolatility(coin: string): Promise<CoinVolatility | null> {
  try {
    // Get 14-day ATR
    const atr14Result = await hyperliquid.calculateATR(coin, 14);
    if (!atr14Result) return null;

    // Get 7-day ATR
    const atr7Result = await hyperliquid.calculateATR(coin, 7);

    // Get recent candles for daily range calculation
    const endTime = Date.now();
    const startTime = endTime - 7 * 24 * 60 * 60 * 1000;
    const candles = await hyperliquid.getCandles(coin, '1d', startTime, endTime);

    if (candles.length === 0) return null;

    // Calculate average daily range as percentage
    let totalRangePct = 0;
    for (const candle of candles) {
      const high = parseFloat(candle.h);
      const low = parseFloat(candle.l);
      const mid = (high + low) / 2;
      const rangePct = ((high - low) / mid) * 100;
      totalRangePct += rangePct;
    }
    const dailyRangeAvg = totalRangePct / candles.length;

    // Get current price and 24h change
    const latestCandle = candles[candles.length - 1];
    const lastPrice = parseFloat(latestCandle.c);
    
    let priceChange24hPct = 0;
    if (candles.length >= 2) {
      const prevClose = parseFloat(candles[candles.length - 2].c);
      priceChange24hPct = ((lastPrice - prevClose) / prevClose) * 100;
    }

    const volatility: CoinVolatility = {
      coin,
      atr14d: atr14Result.atr,
      atr7d: atr7Result?.atr || atr14Result.atr,
      dailyRangeAvg,
      volatilityRank: 0, // Will be calculated after all coins
      lastPrice,
      priceChange24hPct,
    };

    return volatility;
  } catch (error) {
    logger.error(`Failed to calculate volatility for ${coin}`, error);
    return null;
  }
}

/**
 * Update volatility for all tracked coins
 */
export async function updateAllVolatility(): Promise<void> {
  try {
    // Get all coins we're tracking
    const { data: positions } = await db.client
      .from('trader_positions')
      .select('coin')
      .limit(1000);

    const coinsFromPositions = new Set(positions?.map(p => p.coin) || []);

    // Add major coins
    const majorCoins = ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'DOGE', 'SUI', 'AVAX', 'LINK', 'BNB', 
                        'ARB', 'OP', 'MATIC', 'APT', 'INJ', 'SEI', 'TIA', 'JUP', 'WIF', 'PEPE'];
    
    for (const coin of majorCoins) {
      coinsFromPositions.add(coin);
    }

    const allCoins = Array.from(coinsFromPositions);
    logger.info(`Updating volatility for ${allCoins.length} coins...`);

    const volatilities: CoinVolatility[] = [];

    // Calculate volatility for each coin
    for (const coin of allCoins) {
      const vol = await calculateCoinVolatility(coin);
      if (vol) {
        volatilities.push(vol);
      }
      await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
    }

    // Calculate volatility ranks (percentile-based)
    volatilities.sort((a, b) => a.dailyRangeAvg - b.dailyRangeAvg);
    for (let i = 0; i < volatilities.length; i++) {
      volatilities[i].volatilityRank = Math.round((i / (volatilities.length - 1)) * 100);
    }

    // Save to database and cache
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
 * Get volatility data for a coin
 */
export async function getVolatility(coin: string): Promise<CoinVolatility | null> {
  // Check cache first
  const cached = volatilityCache.get(coin);
  if (cached && lastCacheUpdate && (Date.now() - lastCacheUpdate.getTime()) < 60 * 60 * 1000) {
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
      atr14d: parseFloat(data.atr_14d),
      atr7d: parseFloat(data.atr_7d),
      dailyRangeAvg: parseFloat(data.daily_range_avg),
      volatilityRank: data.volatility_rank,
      lastPrice: parseFloat(data.last_price),
      priceChange24hPct: parseFloat(data.price_change_24h_pct),
    };
    volatilityCache.set(coin, vol);
    return vol;
  }

  // Calculate on demand if not found
  const calculated = await calculateCoinVolatility(coin);
  if (calculated) {
    volatilityCache.set(coin, calculated);
  }
  return calculated;
}

/**
 * Calculate volatility-adjusted stop loss
 * Uses ATR to determine appropriate stop distance
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
  if (!vol) {
    const defaultStop = direction === 'long' 
      ? entryPrice * 0.97 
      : entryPrice * 1.03;
    return {
      stopLoss: defaultStop,
      stopDistancePct: 3,
      atr: 0,
      volatilityRank: 50,
    };
  }

  // Calculate stop distance based on ATR
  const atrDistance = vol.atr14d * atrMultiple;
  const stopDistancePct = (atrDistance / entryPrice) * 100;

  // Apply minimum and maximum bounds
  const minStopPct = 1; // At least 1%
  const maxStopPct = 10; // No more than 10%
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
 * Get coins by volatility (useful for filtering)
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
    atr14d: parseFloat(d.atr_14d),
    atr7d: parseFloat(d.atr_7d),
    dailyRangeAvg: parseFloat(d.daily_range_avg),
    volatilityRank: d.volatility_rank,
    lastPrice: parseFloat(d.last_price),
    priceChange24hPct: parseFloat(d.price_change_24h_pct),
  }));
}

/**
 * Get most volatile coins (for higher risk/reward plays)
 */
export async function getMostVolatileCoins(limit: number = 10): Promise<CoinVolatility[]> {
  return getCoinsByVolatility(75, 100).then(coins => coins.slice(0, limit));
}

/**
 * Get least volatile coins (for safer plays)
 */
export async function getLeastVolatileCoins(limit: number = 10): Promise<CoinVolatility[]> {
  const { data } = await db.client
    .from('coin_volatility')
    .select('*')
    .order('volatility_rank', { ascending: true })
    .limit(limit);

  if (!data) return [];

  return data.map(d => ({
    coin: d.coin,
    atr14d: parseFloat(d.atr_14d),
    atr7d: parseFloat(d.atr_7d),
    dailyRangeAvg: parseFloat(d.daily_range_avg),
    volatilityRank: d.volatility_rank,
    lastPrice: parseFloat(d.last_price),
    priceChange24hPct: parseFloat(d.price_change_24h_pct),
  }));
}

// ============================================
// Polling Loop
// ============================================

let volatilityInterval: NodeJS.Timeout | null = null;

export function startVolatilityTracker(): void {
  logger.info('Starting volatility tracker...');
  
  // Initial update
  updateAllVolatility();
  
  // Update every 2 hours
  volatilityInterval = setInterval(updateAllVolatility, 2 * 60 * 60 * 1000);
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