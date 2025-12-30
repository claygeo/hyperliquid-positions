// Funding Tracker V4
// Monitors funding rates and trader funding exposure
// Provides context for signal generation (favorable/unfavorable funding)

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import hyperliquid from '../utils/hyperliquid-api.js';

const logger = createLogger('funding-tracker');

// ============================================
// Types
// ============================================

interface FundingSnapshot {
  coin: string;
  fundingRate: number;
  premium: number;
  openInterest: number;
  annualizedRate: number;
}

interface TraderFundingExposure {
  address: string;
  netFunding7d: number;
  netFunding30d: number;
  avgFundingRatePaid: number;
  positionsPayingFunding: number;
  positionsReceivingFunding: number;
}

// ============================================
// Core Functions
// ============================================

/**
 * Snapshot current funding rates for all coins
 */
export async function snapshotFundingRates(): Promise<FundingSnapshot[]> {
  try {
    const fundingData = await hyperliquid.getCurrentFundingRates();
    const snapshots: FundingSnapshot[] = [];
    const now = new Date().toISOString();

    for (const [coin, data] of fundingData) {
      // Skip coins with zero or negligible OI
      if (data.openInterest < 10000) continue;

      // Annualized rate = hourly rate * 24 * 365 (funding every 8h = 3x/day)
      const annualizedRate = data.fundingRate * 3 * 365 * 100;

      const snapshot: FundingSnapshot = {
        coin,
        fundingRate: data.fundingRate,
        premium: data.premium,
        openInterest: data.openInterest,
        annualizedRate,
      };

      snapshots.push(snapshot);

      // Save to database
      await db.client.from('funding_rates').insert({
        coin,
        funding_rate: data.fundingRate,
        premium: data.premium,
        open_interest: data.openInterest,
        next_funding_time: data.nextFundingTime.toISOString(),
        snapshot_at: now,
      });
    }

    logger.debug(`Snapshotted funding rates for ${snapshots.length} coins`);
    return snapshots;
  } catch (error) {
    logger.error('Failed to snapshot funding rates', error);
    return [];
  }
}

/**
 * Determine funding context for a position
 * Returns: 'favorable', 'neutral', or 'unfavorable'
 */
export function getFundingContext(
  direction: 'long' | 'short',
  fundingRate: number
): 'favorable' | 'neutral' | 'unfavorable' {
  // Positive funding = longs pay shorts
  // Negative funding = shorts pay longs
  
  const threshold = 0.0001; // 0.01% per 8h = ~11% annualized
  
  if (direction === 'long') {
    if (fundingRate < -threshold) return 'favorable'; // You get paid
    if (fundingRate > threshold) return 'unfavorable'; // You pay
    return 'neutral';
  } else {
    if (fundingRate > threshold) return 'favorable'; // You get paid
    if (fundingRate < -threshold) return 'unfavorable'; // You pay
    return 'neutral';
  }
}

/**
 * Calculate funding exposure for a trader
 */
export async function calculateTraderFundingExposure(
  address: string
): Promise<TraderFundingExposure | null> {
  try {
    const [funding7d, funding30d, positions] = await Promise.all([
      hyperliquid.calculateNetFunding(address, 7),
      hyperliquid.calculateNetFunding(address, 30),
      hyperliquid.getClearinghouseState(address),
    ]);

    if (!positions) return null;

    // Get current funding rates
    const fundingRates = await hyperliquid.getCurrentFundingRates();

    // Count positions by funding direction
    let payingFunding = 0;
    let receivingFunding = 0;

    for (const ap of positions.assetPositions) {
      const pos = ap.position;
      const size = parseFloat(pos.szi);
      if (size === 0) continue;

      const fundingData = fundingRates.get(pos.coin);
      if (!fundingData) continue;

      const isLong = size > 0;
      const context = getFundingContext(
        isLong ? 'long' : 'short',
        fundingData.fundingRate
      );

      if (context === 'favorable') {
        receivingFunding++;
      } else if (context === 'unfavorable') {
        payingFunding++;
      }
    }

    const exposure: TraderFundingExposure = {
      address,
      netFunding7d: funding7d.netFunding,
      netFunding30d: funding30d.netFunding,
      avgFundingRatePaid: funding7d.avgRate,
      positionsPayingFunding: payingFunding,
      positionsReceivingFunding: receivingFunding,
    };

    // Save to database
    await db.client
      .from('trader_funding_exposure')
      .upsert({
        address,
        net_funding_7d: exposure.netFunding7d,
        net_funding_30d: exposure.netFunding30d,
        avg_funding_rate_paid: exposure.avgFundingRatePaid,
        positions_paying_funding: payingFunding,
        positions_receiving_funding: receivingFunding,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'address' });

    return exposure;
  } catch (error) {
    logger.error(`Failed to calculate funding exposure for ${address}`, error);
    return null;
  }
}

/**
 * Get current funding rate for a coin
 */
export async function getCurrentFundingRate(coin: string): Promise<number | null> {
  const rates = await hyperliquid.getCurrentFundingRates();
  const data = rates.get(coin);
  return data ? data.fundingRate : null;
}

/**
 * Get funding summary for signal context
 */
export async function getSignalFundingContext(
  coin: string,
  direction: 'long' | 'short'
): Promise<{
  context: 'favorable' | 'neutral' | 'unfavorable';
  fundingRate: number;
  annualizedPct: number;
  hourlyUsdPer100k: number;
}> {
  const rate = await getCurrentFundingRate(coin);
  
  if (rate === null) {
    return {
      context: 'neutral',
      fundingRate: 0,
      annualizedPct: 0,
      hourlyUsdPer100k: 0,
    };
  }

  const context = getFundingContext(direction, rate);
  const annualizedPct = rate * 3 * 365 * 100; // 3 fundings per day
  const hourlyUsdPer100k = rate * 100000 / 8; // Per hour for $100k position

  return {
    context,
    fundingRate: rate,
    annualizedPct,
    hourlyUsdPer100k,
  };
}

/**
 * Get top funding rates (for finding opportunities)
 */
export async function getTopFundingRates(
  limit: number = 10
): Promise<Array<{
  coin: string;
  fundingRate: number;
  annualizedPct: number;
  direction: 'pay_longs' | 'pay_shorts';
}>> {
  const rates = await hyperliquid.getCurrentFundingRates();
  const results: Array<{
    coin: string;
    fundingRate: number;
    annualizedPct: number;
    direction: 'pay_longs' | 'pay_shorts';
  }> = [];

  for (const [coin, data] of rates) {
    const annualizedPct = data.fundingRate * 3 * 365 * 100;
    results.push({
      coin,
      fundingRate: data.fundingRate,
      annualizedPct,
      direction: data.fundingRate > 0 ? 'pay_longs' : 'pay_shorts',
    });
  }

  // Sort by absolute funding rate
  results.sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate));

  return results.slice(0, limit);
}

/**
 * Update funding exposure for all tracked traders
 */
export async function updateAllTraderFunding(): Promise<void> {
  try {
    const { data: traders } = await db.client
      .from('trader_quality')
      .select('address')
      .eq('is_tracked', true);

    if (!traders) return;

    logger.info(`Updating funding exposure for ${traders.length} traders...`);

    for (const trader of traders) {
      await calculateTraderFundingExposure(trader.address);
      await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit
    }

    logger.info('Funding exposure update complete');
  } catch (error) {
    logger.error('Failed to update trader funding', error);
  }
}

// ============================================
// Polling Loop
// ============================================

let fundingInterval: NodeJS.Timeout | null = null;
let traderFundingInterval: NodeJS.Timeout | null = null;

export function startFundingTracker(): void {
  logger.info('Starting funding tracker...');

  // Snapshot funding rates every 30 minutes
  snapshotFundingRates();
  fundingInterval = setInterval(snapshotFundingRates, 30 * 60 * 1000);

  // Update trader funding exposure every 4 hours
  traderFundingInterval = setInterval(updateAllTraderFunding, 4 * 60 * 60 * 1000);
}

export function stopFundingTracker(): void {
  if (fundingInterval) {
    clearInterval(fundingInterval);
    fundingInterval = null;
  }
  if (traderFundingInterval) {
    clearInterval(traderFundingInterval);
    traderFundingInterval = null;
  }
  logger.info('Funding tracker stopped');
}

export default {
  startFundingTracker,
  stopFundingTracker,
  snapshotFundingRates,
  getFundingContext,
  calculateTraderFundingExposure,
  getCurrentFundingRate,
  getSignalFundingContext,
  getTopFundingRates,
  updateAllTraderFunding,
};