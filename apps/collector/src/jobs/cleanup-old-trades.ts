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
    // Delete trades older than 30 days
    const deletedTrades = await deleteOldTrades(30);

    // Deactivate old signals (older than 24 hours)
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const { data: deactivated } = await db.client
      .from('signals')
      .update({ is_active: false })
      .eq('is_active', true)
      .lt('created_at', oneDayAgo.toISOString())
      .select('id');

    // Delete signals older than 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: deletedSignals } = await db.client
      .from('signals')
      .delete()
      .lt('created_at', sevenDaysAgo.toISOString())
      .select('id');

    // Remove wallets with no recent trades and bad score
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: removedWallets } = await db.client
      .from('wallets')
      .delete()
      .lt('last_trade_at', thirtyDaysAgo.toISOString())
      .lt('score', 30)
      .select('address');

    logger.info('Cleanup complete', {
      deletedTrades,
      deactivatedSignals: deactivated?.length || 0,
      deletedSignals: deletedSignals?.length || 0,
      removedWallets: removedWallets?.length || 0,
    });
  } catch (error) {
    logger.error('Cleanup job failed', error);
    throw error;
  }
}

export default cleanupOldTradesJob;