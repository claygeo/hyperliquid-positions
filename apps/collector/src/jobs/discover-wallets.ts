// Discover wallets job - find new interesting wallets to track

import { HyperliquidClient } from '@hyperliquid-tracker/sdk';
import { DISCOVERY_THRESHOLDS, SCORING_THRESHOLDS } from '@hyperliquid-tracker/shared';
import type { DBWalletInsert } from '@hyperliquid-tracker/shared';
import { createLogger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import CONFIG from '../config.js';
import { getWallet, bulkUpsertWallets } from '../db/wallets.js';
import { getRecentTrades } from '../db/trades.js';

const logger = createLogger('jobs:discover');

/**
 * Job to discover new wallets worth tracking
 */
export async function discoverWalletsJob(): Promise<void> {
  logger.info('Starting wallet discovery job');
  
  try {
    // Get recent trades to find active wallets
    const since = new Date(Date.now() - 60 * 60 * 1000); // Last hour
    const recentTrades = await getRecentTrades(since, 5000);
    
    // Count trades and volume per wallet
    const walletStats: Map<string, { trades: number; volume: number; firstSeen: Date }> = new Map();
    
    for (const trade of recentTrades) {
      const stats = walletStats.get(trade.wallet);
      const tradeVolume = trade.size * trade.price;
      
      if (stats) {
        stats.trades++;
        stats.volume += tradeVolume;
      } else {
        walletStats.set(trade.wallet, {
          trades: 1,
          volume: tradeVolume,
          firstSeen: new Date(trade.timestamp),
        });
      }
    }
    
    // Filter for interesting wallets
    const candidates: DBWalletInsert[] = [];
    
    for (const [address, stats] of walletStats) {
      // Skip if below thresholds
      if (stats.trades < DISCOVERY_THRESHOLDS.MIN_TRADES_FOR_DISCOVERY) continue;
      if (stats.volume < DISCOVERY_THRESHOLDS.MIN_VOLUME_FOR_DISCOVERY) continue;
      
      // Check if already tracking
      const existing = await getWallet(address);
      if (existing) continue;
      
      // Check wallet role (skip vaults, subaccounts, etc)
      // In production, you'd call client.getUserRole(address)
      
      candidates.push({
        address,
        first_seen: stats.firstSeen.toISOString(),
        total_trades: stats.trades,
        total_volume: stats.volume,
        is_active: true,
      });
      
      // Limit new discoveries per run
      if (candidates.length >= DISCOVERY_THRESHOLDS.MAX_NEW_WALLETS_PER_HOUR) {
        break;
      }
    }
    
    // Save new wallets
    if (candidates.length > 0) {
      await bulkUpsertWallets(candidates);
      metrics.increment('wallets_discovered', candidates.length);
      logger.info(`Discovered ${candidates.length} new wallets`);
    } else {
      logger.debug('No new wallets discovered');
    }
  } catch (error) {
    logger.error('Wallet discovery job failed', error);
    throw error;
  }
}

/**
 * Discover wallets from the leaderboard
 */
export async function discoverFromLeaderboard(): Promise<void> {
  const client = new HyperliquidClient({
    apiUrl: CONFIG.hyperliquid.apiUrl,
  });

  try {
    const leaderboard = await client.getLeaderboard() as any;
    
    if (!leaderboard || !Array.isArray(leaderboard)) {
      logger.warn('Invalid leaderboard response');
      return;
    }

    const candidates: DBWalletInsert[] = [];

    for (const entry of leaderboard.slice(0, 100)) {
      const address = entry.address || entry.user;
      if (!address) continue;

      const existing = await getWallet(address);
      if (existing) continue;

      candidates.push({
        address,
        first_seen: new Date().toISOString(),
        total_trades: 0,
        total_volume: entry.volume || 0,
        is_active: true,
        metadata: {
          source: 'leaderboard',
          rank: entry.rank,
        },
      });
    }

    if (candidates.length > 0) {
      await bulkUpsertWallets(candidates);
      logger.info(`Added ${candidates.length} wallets from leaderboard`);
    }
  } catch (error) {
    logger.error('Failed to discover from leaderboard', error);
  }
}

export default discoverWalletsJob;
