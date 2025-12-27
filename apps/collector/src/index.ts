// Collector entry point

import { config } from 'dotenv';
config();

import CONFIG, { validateConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { metrics } from './utils/metrics.js';
import { getTradeStreamCollector } from './collectors/trade-stream.js';
import { getPositionPoller } from './collectors/position-poller.js';
import { scheduler } from './jobs/scheduler.js';
import { cleanupOldTradesJob } from './jobs/cleanup-old-trades.js';
import { flushPendingData } from './processors/trade-processor.js';
import { getTopAlphaWallets } from './processors/alpha-detector.js';

const logger = createLogger('main');

async function main(): Promise<void> {
  logger.info('Starting Hyperliquid Alpha Tracker');

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
    // Start trade stream (includes alpha detection)
    await tradeCollector.start();
    logger.info('Trade stream collector started with alpha detection');

    // Start position polling
    await positionPoller.start();
    logger.info('Position poller started');

    // Register cleanup job
    scheduler.register('cleanup', cleanupOldTradesJob, 6 * 60 * 60 * 1000); // Every 6 hours

    // Start scheduler
    scheduler.start();
    logger.info('Job scheduler started');

    // Log top wallets periodically
    setInterval(async () => {
      const topWallets = await getTopAlphaWallets(10);
      if (topWallets.length > 0) {
        logger.info('Current top alpha wallets:', {
          wallets: topWallets.map(w => ({
            address: w.address.slice(0, 10) + '...',
            score: w.score,
            winRate: w.win_rate?.toFixed(1) + '%',
            pnl: '$' + (w.realized_pnl || 0).toFixed(2),
            trades: w.total_trades,
          }))
        });
      }
    }, 5 * 60 * 1000); // Every 5 minutes

    // Log metrics periodically
    setInterval(() => {
      metrics.logSummary();
    }, 5 * 60 * 1000);

    logger.info('Alpha Tracker fully operational');
    logger.info('Watching trade stream for skilled traders...');

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

  scheduler.stop();
  await flushPendingData();
  await tradeCollector.stop();
  await positionPoller.stop();

  metrics.logSummary();
  logger.info('Shutdown complete');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});