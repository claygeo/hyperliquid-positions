// Wallet scorer - scores wallets based on performance
// Note: Most scoring is now done by alpha-detector.ts

import { createLogger } from '../utils/logger.js';
import { getTopWallets } from '../db/wallets.js';

const logger = createLogger('processors:wallet-scorer');

/**
 * Score all wallets (now handled by alpha-detector flush)
 */
export async function scoreAllWallets(minTrades: number = 5): Promise<void> {
  logger.debug('Wallet scoring handled by alpha detector');
}

/**
 * Get top wallets by score
 */
export async function getTopScoredWallets(limit: number = 50, minTrades: number = 5): Promise<any[]> {
  return getTopWallets(limit, minTrades);
}

export default {
  scoreAllWallets,
  getTopScoredWallets,
};