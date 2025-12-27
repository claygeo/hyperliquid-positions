// Cleanup old trades job

import { deleteOldTrades } from '../db/trades.js';
import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';

const logger = createLogger('jobs:cleanup');

/**
 * Clean up old data
 */
export async function cleanupOldTradesJob(): Promise<void> {
  logger.info('Starting cleanup job');

  try {
    const deletedTrades = await deleteOldTrades(30);

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const { data: deactivated } = await db.client
      .from('signals')
      .update({ is_active: false })
      .eq('is_active', true)
      .lt('created_at', oneDayAgo.toISOString())
      .select('id');

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: deletedSignals } = await db.client
      .from('signals')
      .delete()
      .lt('created_at', sevenDaysAgo.toISOString())
      .select('id');

    const { data: clearedPositions } = await db.client
      .from('positions')
      .delete()
      .lt('updated_at', oneDayAgo.toISOString())
      .select('id');

    logger.info('Cleanup complete', {
      deletedTrades,
      deactivatedSignals: deactivated?.length || 0,
      deletedSignals: deletedSignals?.length || 0,
      clearedPositions: clearedPositions?.length || 0,
    });
  } catch (error) {
    logger.error('Cleanup job failed', error);
    throw error;
  }
}

export default cleanupOldTradesJob;