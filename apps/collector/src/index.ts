// Collector entry point - Convergence Detection System

import { config } from 'dotenv';
config();

import CONFIG, { validateConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { metrics } from './utils/metrics.js';
import { startLeaderboardFetcher, stopLeaderboardFetcher, getLeaderboardWallets } from './collectors/leaderboard-fetcher.js';
import { startPositionTracker, stopPositionTracker } from './collectors/position-tracker.js';
import { getActiveSignals, expireOldSignals } from './processors/convergence-detector.js';
import { scheduler } from './jobs/scheduler.js';

const logger = createLogger('main');

async function main(): Promise<void> {
  logger.info('');
  logger.info('═══════════════════════════════════════════════════════════════');
  logger.info('   Hyperliquid Convergence Tracker');
  logger.info('   Detecting when top traders align on positions');
  logger.info('═══════════════════════════════════════════════════════════════');
  logger.info('');

  // Validate configuration
  try {
    validateConfig();
  } catch (error) {
    logger.error('Configuration error', error);
    process.exit(1);
  }

  try {
    // Step 1: Fetch leaderboard wallets
    logger.info('Step 1: Fetching top traders from leaderboard...');
    await startLeaderboardFetcher();
    
    const wallets = await getLeaderboardWallets(100);
    logger.info(`Tracking ${wallets.length} top traders`);
    
    // Step 2: Start position tracking
    logger.info('Step 2: Starting position tracker...');
    await startPositionTracker();
    
    // Step 3: Register cleanup job (pass function directly)
    scheduler.register('expire-signals', expireOldSignals, 15 * 60 * 1000);
    
    scheduler.start();
    logger.info('Step 3: Scheduler started');

    // Log status periodically
    setInterval(async () => {
      const signals = await getActiveSignals();
      const walletCount = (await getLeaderboardWallets(200)).length;
      
      logger.info('');
      logger.info('── Status Update ──────────────────────────────');
      logger.info(`Tracking: ${walletCount} wallets`);
      logger.info(`Active signals: ${signals.length}`);
      
      if (signals.length > 0) {
        logger.info('Current signals:');
        for (const sig of signals.slice(0, 5)) {
          logger.info(`  • ${sig.coin} ${sig.direction.toUpperCase()} - ${sig.wallet_count} wallets (${sig.confidence}% confidence)`);
        }
      }
      logger.info('───────────────────────────────────────────────');
      logger.info('');
    }, 5 * 60 * 1000);

    // Log metrics periodically
    setInterval(() => {
      metrics.logSummary();
    }, 10 * 60 * 1000);

    logger.info('');
    logger.info('✅ Convergence Tracker fully operational');
    logger.info('   Watching for signals when 3+ traders enter same position...');
    logger.info('');

  } catch (error) {
    logger.error('Failed to start collector', error);
    await shutdown();
    process.exit(1);
  }

  // Handle graceful shutdown
  const handleShutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await shutdown();
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

async function shutdown(): Promise<void> {
  logger.info('Shutting down...');

  scheduler.stop();
  await stopPositionTracker();
  await stopLeaderboardFetcher();

  metrics.logSummary();
  logger.info('Shutdown complete');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});