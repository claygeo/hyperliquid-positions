// Backfill prices job - fill in price data after entries

import { analyzeEntries, clearOldCache } from '../processors/entry-analyzer.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('jobs:backfill-prices');

/**
 * Job to backfill price data for entry scoring
 */
export async function backfillPricesJob(): Promise<void> {
  logger.info('Starting price backfill job');
  
  try {
    const analyzed = await analyzeEntries();
    logger.info(`Price backfill complete: ${analyzed} trades analyzed`);
    
    clearOldCache();
  } catch (error) {
    logger.error('Price backfill job failed', error);
    throw error;
  }
}

export default backfillPricesJob;