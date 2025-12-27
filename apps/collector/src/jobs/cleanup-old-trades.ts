// Cleanup old trades job

import { deleteOldTrades } from '../db/trades.js';
import { createLogger } from '../utils/logger.js';
import supabase from '../db/client.js';

const logger = createLogger('jobs:cleanup');

/**
 * Clean up old data
 */
export async function cleanupJob(): Promise<void> {
  logger.info('Starting cleanup job');

  try {
    // Delete trades older than 30 days
    const deletedTrades = await deleteOldTrades(30);

    // Deactivate old signals (older than 24 hours)
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const { data: deactivated } = await supabase
      .from('signals')
      .update({ is_active: false })
      .eq('is_active', true)
      .lt('created_at', oneDayAgo.toISOString())
      .select('id');

    // Delete signals older than 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: deletedSignals } = await supabase
      .from('signals')
      .delete()
      .lt('created_at', sevenDaysAgo.toISOString())
      .select('id');

    // Clear stale positions (not updated in 24 hours)
    const { data: clearedPositions } = await supabase
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

export default cleanupJob;