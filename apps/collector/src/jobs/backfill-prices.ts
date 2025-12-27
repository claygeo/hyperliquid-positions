// Backfill prices job - simplified

import { createLogger } from '../utils/logger.js';

const logger = createLogger('jobs:backfill-prices');

/**
 * Backfill prices (no longer needed - using closedPnl)
 */
export async function backfillPricesJob(): Promise<void> {
  logger.debug('Price backfill skipped - using closedPnl for scoring');
}

export default backfillPricesJob;