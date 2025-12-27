// Update scores job - periodically recalculate wallet scores

import { scoreWallets } from '../processors/wallet-scorer.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('jobs:update-scores');

/**
 * Job to update wallet scores
 */
export async function updateScoresJob(): Promise<void> {
  logger.info('Starting score update job');
  
  try {
    const scored = await scoreWallets(100);
    logger.info(`Score update complete: ${scored} wallets scored`);
  } catch (error) {
    logger.error('Score update job failed', error);
    throw error;
  }
}

export default updateScoresJob;
