// Collector Entry Point - Quality Trader System
// This runs continuously on Render, tracking positions and generating signals

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createLogger } from './utils/logger.js';
import { startPositionTracker, stopPositionTracker, getPositionStats } from './processors/position-tracker.js';
import { getQualityStats, analyzeTrader, saveTraderAnalysis } from './processors/pnl-analyzer.js';
import { getActiveSignals } from './processors/signal-generator.js';
import db from './db/client.js';
import { config } from './config.js';

const logger = createLogger('main');

// ============================================
// Periodic Re-analysis of Quality Traders
// ============================================

async function reanalyzeQualityTraders(): Promise<void> {
  try {
    // Get traders due for re-analysis
    const now = new Date();
    
    // Elite traders: re-analyze every hour
    const eliteResult = await db.client
      .from('trader_quality')
      .select('address')
      .eq('quality_tier', 'elite')
      .lt('analyzed_at', new Date(now.getTime() - config.analysis.reanalyzeEliteHours * 60 * 60 * 1000).toISOString())
      .limit(10);
    
    // Good traders: re-analyze every 4 hours
    const goodResult = await db.client
      .from('trader_quality')
      .select('address')
      .eq('quality_tier', 'good')
      .lt('analyzed_at', new Date(now.getTime() - config.analysis.reanalyzeGoodHours * 60 * 60 * 1000).toISOString())
      .limit(10);
    
    const toAnalyze = [
      ...(eliteResult.data || []),
      ...(goodResult.data || []),
    ];
    
    if (toAnalyze.length === 0) return;
    
    logger.info(`Re-analyzing ${toAnalyze.length} traders...`);
    
    for (const trader of toAnalyze) {
      const analysis = await analyzeTrader(trader.address);
      if (analysis) {
        await saveTraderAnalysis(analysis);
        
        // Log tier changes
        logger.info(`  ${trader.address.slice(0, 8)}... → ${analysis.quality_tier} ($${Math.round(analysis.pnl_7d).toLocaleString()} 7d)`);
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  } catch (error) {
    logger.error('Re-analysis failed', error);
  }
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('QUALITY TRADER SIGNAL SYSTEM');
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
  
  // Check if we have traders to track
  const initialStats = await getQualityStats();
  
  if (initialStats.tracked === 0) {
    logger.warn('');
    logger.warn('No tracked traders found!');
    logger.warn('Please run the setup scripts first:');
    logger.warn('  1. npx ts-node src/scripts/sync-hype-holders.ts');
    logger.warn('  2. npx ts-node src/scripts/analyze-traders.ts');
    logger.warn('');
    logger.warn('The system will continue but no signals will be generated.');
    logger.warn('');
  } else {
    logger.info('Quality Traders:');
    logger.info(`  Elite: ${initialStats.elite}`);
    logger.info(`  Good:  ${initialStats.good}`);
    logger.info(`  Total tracked: ${initialStats.tracked}`);
    logger.info('');
  }
  
  try {
    // Start position tracker (runs every 60s)
    logger.info('Starting position tracker...');
    startPositionTracker();
    
    // Start periodic re-analysis (runs every 5 minutes)
    logger.info('Starting periodic re-analysis...');
    setInterval(reanalyzeQualityTraders, 5 * 60 * 1000);
    
    logger.info('');
    logger.info('System fully operational');
    logger.info('');
    
    // Status logging every 5 minutes
    setInterval(async () => {
      try {
        const qualityStats = await getQualityStats();
        const positionStats = await getPositionStats();
        const activeSignals = await getActiveSignals();
        
        logger.info('');
        logger.info('-'.repeat(50));
        logger.info('STATUS UPDATE');
        logger.info('-'.repeat(50));
        logger.info(`Quality: ${qualityStats.elite} Elite | ${qualityStats.good} Good | ${qualityStats.tracked} Tracked`);
        logger.info(`Positions: ${positionStats.totalPositions} total | ${positionStats.uniqueCoins} coins`);
        logger.info(`Active Signals: ${activeSignals.length}`);
        
        if (activeSignals.length > 0) {
          logger.info('');
          logger.info('Current Signals:');
          for (const signal of activeSignals.slice(0, 5)) {
            const strength = signal.signal_strength === 'strong' ? 'STRONG' : 'MEDIUM';
            logger.info(`  ${signal.coin} ${signal.direction.toUpperCase()} | ${signal.elite_count}E + ${signal.good_count}G | $${Math.round(signal.combined_pnl_7d).toLocaleString()} 7d | ${strength}`);
          }
        }
        
        logger.info('-'.repeat(50));
        logger.info('');
      } catch (err) {
        logger.error('Status update failed', err);
      }
    }, 5 * 60 * 1000);
    
  } catch (error) {
    logger.error('Failed to start system', error);
    process.exit(1);
  }
  
  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
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