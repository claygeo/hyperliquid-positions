// Update wallet scores job

import { scoreAllWallets } from '../processors/wallet-scorer.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('jobs:update-scores');

/**
 * Job to update all wallet scores
 */
export async function updateScoresJob(): Promise<void> {
  logger.info('Starting wallet score update job');
  
  try {
    await scoreAllWallets(20);
    logger.info('Wallet score update complete');
  } catch (error) {
    logger.error('Wallet score update failed', error);
    throw error;
  }
}

export default updateScoresJob;