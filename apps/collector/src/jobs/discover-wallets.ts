// Discover new high-performing wallets

import { createLogger } from '../utils/logger.js';
import { getRecentTrades } from '../db/trades.js';
import { upsertWallet, getWalletsForScoring } from '../db/wallets.js';

const logger = createLogger('jobs:discover-wallets');

/**
 * Discover new wallets from recent trades
 */
export async function discoverWalletsJob(): Promise<void> {
  logger.info('Starting wallet discovery job');

  try {
    const trades = await getRecentTrades(1000);
    const walletAddresses = [...new Set(trades.map(t => t.wallet))];

    // Get existing wallets to check against
    const existingWallets = await getWalletsForScoring(0);
    const existingAddresses = new Set(existingWallets.map(w => w.address));

    let newWallets = 0;
    let existingCount = 0;

    for (const address of walletAddresses) {
      if (!existingAddresses.has(address)) {
        await upsertWallet({ address });
        newWallets++;
      } else {
        existingCount++;
      }
    }

    logger.info('Wallet discovery complete', {
      total: walletAddresses.length,
      new: newWallets,
      existing: existingCount,
    });
  } catch (error) {
    logger.error('Wallet discovery failed', error);
    throw error;
  }
}

/**
 * Discover wallets from leaderboard (placeholder)
 */
export async function discoverFromLeaderboard(): Promise<void> {
  logger.info('Leaderboard discovery not yet implemented');
}

export default discoverWalletsJob;