// Discover new high-performing wallets

import { createLogger } from '../utils/logger.js';
import { getRecentTrades } from '../db/trades.js';
import { upsertWallet, getWalletByAddress } from '../db/wallets.js';

const logger = createLogger('jobs:discover-wallets');

/**
 * Discover new wallets from recent trades
 */
export async function discoverWalletsJob(): Promise<void> {
  logger.info('Starting wallet discovery job');

  try {
    // Get recent trades
    const trades = await getRecentTrades(1000);

    // Extract unique wallets
    const walletAddresses = [...new Set(trades.map(t => t.wallet))];

    let newWallets = 0;
    let existingWallets = 0;

    for (const address of walletAddresses) {
      // Check if wallet already exists
      const existing = await getWalletByAddress(address);

      if (!existing) {
        // Create new wallet
        await upsertWallet({
          address,
          is_tracked: false,
          is_bot: false,
        });
        newWallets++;
      } else {
        existingWallets++;
      }
    }

    logger.info('Wallet discovery complete', {
      total: walletAddresses.length,
      new: newWallets,
      existing: existingWallets,
    });
  } catch (error) {
    logger.error('Wallet discovery failed', error);
    throw error;
  }
}

export default discoverWalletsJob;