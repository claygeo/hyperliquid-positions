// Cleanup old trades job - archive old data to keep database size manageable

import { deleteOldTrades } from '../db/trades.js';
import { deleteOldSignals, deactivateExpiredSignals } from '../db/signals.js';
import { clearStalePositions } from '../db/positions.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('jobs:cleanup');

// Keep trades for 30 days
const TRADE_RETENTION_DAYS = 30;
// Keep inactive signals for 7 days
const SIGNAL_RETENTION_DAYS = 7;
// Clear positions not updated in 24 hours
const STALE_POSITION_HOURS = 24;

/**
 * Job to clean up old data
 */
export async function cleanupOldTradesJob(): Promise<void> {
  logger.info('Starting cleanup job');
  
  try {
    // Delete old trades
    const tradesCutoff = new Date(Date.now() - TRADE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deletedTrades = await deleteOldTrades(tradesCutoff);
    
    // Deactivate expired signals
    const deactivatedSignals = await deactivateExpiredSignals();
    
    // Delete old inactive signals
    const signalsCutoff = new Date(Date.now() - SIGNAL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deletedSignals = await deleteOldSignals(signalsCutoff);
    
    // Clear stale positions
    const positionsCutoff = new Date(Date.now() - STALE_POSITION_HOURS * 60 * 60 * 1000);
    const clearedPositions = await clearStalePositions(positionsCutoff);
    
    logger.info('Cleanup complete', {
      deletedTrades,
      deactivatedSignals,
      deletedSignals,
      clearedPositions,
    });
  } catch (error) {
    logger.error('Cleanup job failed', error);
    throw error;
  }
}

export default cleanupOldTradesJob;
