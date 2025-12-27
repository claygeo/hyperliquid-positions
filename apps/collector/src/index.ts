// Collector entry point - Convergence Tracker

import { config } from 'dotenv';
config();

import { createLogger } from './utils/logger.js';
import { startLeaderboardFetcher } from './collectors/leaderboard-fetcher.js';
import { startPositionTracker } from './collectors/position-tracker.js';
import { getActiveSignals, expireOldSignals } from './processors/convergence-detector.js';
import db from './db/client.js';

var logger = createLogger('main');

async function main(): Promise<void> {
  logger.info('Starting Hyperliquid Convergence Tracker');

  // Validate environment
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    logger.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  logger.info('Configuration validated');

  try {
    // Start leaderboard fetcher (syncs top traders hourly)
    startLeaderboardFetcher();
    logger.info('Leaderboard fetcher started');

    // Start position tracker (polls positions every 60s)
    startPositionTracker();
    logger.info('Position tracker started');

    // Expire old signals periodically
    setInterval(function() {
      expireOldSignals();
    }, 5 * 60 * 1000); // Every 5 minutes

    // Log status periodically
    setInterval(async function() {
      try {
        // Get wallet count
        var walletResult = await db.client
          .from('leaderboard_wallets')
          .select('address', { count: 'exact' });
        
        var walletCount = walletResult.count || 0;

        // Get active signals
        var signals = await getActiveSignals();
        var signalCount = signals.length;

        logger.info('');
        logger.info('── Status Update ──────────────────────────────');
        logger.info('Tracking: ' + walletCount + ' wallets');
        logger.info('Active signals: ' + signalCount);
        
        if (signals.length > 0) {
          logger.info('Current signals:');
          var topSignals = signals.slice(0, 5);
          for (var i = 0; i < topSignals.length; i++) {
            var s = topSignals[i];
            logger.info('  • ' + s.coin + ' ' + s.direction.toUpperCase() + ' - ' + s.wallet_count + ' wallets (' + s.confidence + '% confidence)');
          }
        }
        
        logger.info('───────────────────────────────────────────────');
        logger.info('');
      } catch (err) {
        logger.error('Status update failed', err);
      }
    }, 5 * 60 * 1000); // Every 5 minutes

    logger.info('Convergence Tracker fully operational');
    logger.info('Tracking top traders and detecting convergence...');

  } catch (error) {
    logger.error('Failed to start collector', error);
    process.exit(1);
  }

  // Handle graceful shutdown
  process.on('SIGINT', function() {
    logger.info('Received SIGINT, shutting down...');
    process.exit(0);
  });

  process.on('SIGTERM', function() {
    logger.info('Received SIGTERM, shutting down...');
    process.exit(0);
  });

  process.on('uncaughtException', function(error) {
    logger.error('Uncaught exception', error);
  });

  process.on('unhandledRejection', function(reason) {
    logger.error('Unhandled rejection', reason);
  });
}

main().catch(function(error) {
  console.error('Fatal error:', error);
  process.exit(1);
});