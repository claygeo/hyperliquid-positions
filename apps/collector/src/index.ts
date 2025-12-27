// Collector entry point

import { config } from 'dotenv';
config();

import CONFIG, { validateConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { metrics } from './utils/metrics.js';
import { getTradeStreamCollector } from './collectors/trade-stream.js';
import { getPositionPoller } from './collectors/position-poller.js';
import { scheduler } from './jobs/scheduler.js';
import { updateScoresJob } from './jobs/update-scores.js';
import { backfillPricesJob } from './jobs/backfill-prices.js';
import { cleanupOldTradesJob } from './jobs/cleanup-old-trades.js';
import { discoverWalletsJob } from './jobs/discover-wallets.js';
import { flushPendingData } from './processors/trade-processor.js';

const logger = createLogger('main');

async function main(): Promise<void> {
  logger.info('Starting Hyperliquid Position Tracker Collector');
  
  // Validate configuration
  try {
    validateConfig();
  } catch (error) {
    logger.error('Configuration error', error);
    process.exit(1);
  }

  logger.info('Configuration validated');

  // Start collectors
  const tradeCollector = getTradeStreamCollector();
  const positionPoller = getPositionPoller();

  try {
    // Start trade stream
    await tradeCollector.start();
    logger.info('Trade stream collector started');

    // Start position polling
    await positionPoller.start();
    logger.info('Position poller started');

    // Register jobs
    scheduler.register('updateScores', updateScoresJob, CONFIG.collector.scoreUpdateIntervalMs);
    scheduler.register('backfillPrices', backfillPricesJob, CONFIG.collector.priceBackfillIntervalMs);
    scheduler.register('cleanup', cleanupOldTradesJob, 6 * 60 * 60 * 1000); // Every 6 hours
    scheduler.register('discover', discoverWalletsJob, 30 * 60 * 1000); // Every 30 minutes

    // Start scheduler
    scheduler.start();
    logger.info('Job scheduler started');

    // Log metrics periodically
    setInterval(() => {
      metrics.logSummary();
    }, 5 * 60 * 1000); // Every 5 minutes

    logger.info('Collector fully operational');
  } catch (error) {
    logger.error('Failed to start collector', error);
    await shutdown(tradeCollector, positionPoller);
    process.exit(1);
  }

  // Handle graceful shutdown
  const handleShutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await shutdown(tradeCollector, positionPoller);
    process.exit(0);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    metrics.increment('uncaught_exceptions');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', reason);
    metrics.increment('unhandled_rejections');
  });
}

async function shutdown(
  tradeCollector: ReturnType<typeof getTradeStreamCollector>,
  positionPoller: ReturnType<typeof getPositionPoller>
): Promise<void> {
  logger.info('Shutting down...');

  // Stop scheduler
  scheduler.stop();

  // Flush pending data
  await flushPendingData();

  // Stop collectors
  await tradeCollector.stop();
  await positionPoller.stop();

  // Final metrics log
  metrics.logSummary();

  logger.info('Shutdown complete');
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
