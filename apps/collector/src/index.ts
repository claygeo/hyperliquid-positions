// Collector Entry Point - Quality Trader Discovery System

import { config } from 'dotenv';
config();

import { createLogger } from './utils/logger.js';
import db from './db/client.js';
import { startTradeStream, stopTradeStream } from './collectors/trade-stream.js';
import { startWalletAnalyzer, stopWalletAnalyzer, getQualityStats } from './processors/wallet-analyzer.js';
import { startPositionTracker, stopPositionTracker, getPositionStats } from './collectors/position-tracker.js';
import { getActiveSignals } from './processors/signal-generator.js';

const logger = createLogger('main');

async function main(): Promise<void> {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('QUALITY TRADER DISCOVERY SYSTEM');
  logger.info('='.repeat(60));
  logger.info('');
  
  // Validate environment
  if (!process.env.SUPABASE_URL) {
    logger.error('Missing SUPABASE_URL');
    process.exit(1);
  }
  
  if (!process.env.SUPABASE_SERVICE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.error('Missing SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  
  logger.info('Configuration validated');
  
  try {
    // Start trade stream (discovers new wallets)
    logger.info('Starting trade stream...');
    startTradeStream();
    
    // Start wallet analyzer (calculates quality scores)
    logger.info('Starting wallet analyzer...');
    startWalletAnalyzer();
    
    // Start position tracker (tracks quality traders' positions)
    logger.info('Starting position tracker...');
    startPositionTracker();
    
    logger.info('');
    logger.info('System fully operational');
    logger.info('');
    
    // Log status periodically
    setInterval(async () => {
      try {
        const qualityStats = await getQualityStats();
        const positionStats = await getPositionStats();
        const activeSignals = await getActiveSignals();
        
        logger.info('');
        logger.info('-'.repeat(50));
        logger.info('STATUS UPDATE');
        logger.info('-'.repeat(50));
        logger.info('Quality Traders: ' + qualityStats.elite + ' Elite | ' + qualityStats.good + ' Good | ' + qualityStats.tracked + ' Tracked');
        logger.info('Positions: ' + positionStats.totalPositions + ' total | ' + positionStats.uniqueCoins + ' coins');
        logger.info('Active Signals: ' + activeSignals.length);
        
        if (activeSignals.length > 0) {
          logger.info('');
          logger.info('Current Signals:');
          for (const signal of activeSignals.slice(0, 5)) {
            const strength = signal.signal_strength === 'strong' ? 'STRONG' : 'MEDIUM';
            logger.info('  ' + signal.coin + ' ' + signal.direction.toUpperCase() + ' | ' + signal.elite_count + 'E + ' + signal.good_count + 'G | $' + Math.round(signal.combined_pnl_7d).toLocaleString() + ' 7d PnL | ' + strength);
          }
        }
        
        logger.info('-'.repeat(50));
        logger.info('');
      } catch (err) {
        logger.error('Status update failed', err);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
    
  } catch (error) {
    logger.error('Failed to start system', error);
    process.exit(1);
  }
  
  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    stopTradeStream();
    stopWalletAnalyzer();
    stopPositionTracker();
    logger.info('Shutdown complete');
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
  });
  
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', reason);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});