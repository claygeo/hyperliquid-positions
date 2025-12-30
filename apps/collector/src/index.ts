// Collector Entry Point V3 - Quality Trader Signal System
// Integrates: Signal Generation, Performance Tracking, Trader Re-evaluation

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createLogger } from './utils/logger.js';
import { startPositionTracker, stopPositionTracker, getPositionStats } from './processors/position-tracker.js';
import { getQualityStats, analyzeTrader, saveTraderAnalysis } from './processors/pnl-analyzer.js';
import { generateSignals, getActiveSignals } from './processors/signal-generator.js';
import { startSignalTracker, stopSignalTracker, getPerformanceSummary, getAssetPerformance } from './processors/signal-tracker.js';
import { reEvaluateAllTraders, cleanupOldHistory } from './processors/trader-reeval.js';
import db from './db/client.js';
import { config } from './config.js';

const logger = createLogger('main');

// ============================================
// Periodic Tasks
// ============================================

/**
 * Re-analyze quality traders periodically
 */
async function reanalyzeQualityTraders(): Promise<void> {
  try {
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
        logger.debug(`  ${trader.address.slice(0, 8)}... → ${analysis.quality_tier}`);
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  } catch (error) {
    logger.error('Re-analysis failed', error);
  }
}

/**
 * Log detailed status update
 */
async function logStatusUpdate(): Promise<void> {
  try {
    const qualityStats = await getQualityStats();
    const positionStats = await getPositionStats();
    const activeSignals = await getActiveSignals();
    const perfSummary = await getPerformanceSummary();

    logger.info('');
    logger.info('-'.repeat(60));
    logger.info('STATUS UPDATE');
    logger.info('-'.repeat(60));
    
    // Quality traders
    logger.info(`Quality: ${qualityStats.elite} Elite | ${qualityStats.good} Good | ${qualityStats.tracked} Tracked`);
    logger.info(`Positions: ${positionStats.totalPositions} total | ${positionStats.uniqueCoins} coins`);
    
    // Active signals
    logger.info(`Active Signals: ${activeSignals.length}`);
    
    if (activeSignals.length > 0) {
      logger.info('');
      logger.info('Current Signals:');
      for (const signal of activeSignals.slice(0, 5)) {
        const strength = signal.signal_strength === 'strong' ? 'STRONG' : 'MEDIUM';
        const agreement = ((signal.directional_agreement || 0) * 100).toFixed(0);
        const stopDist = ((signal.stop_distance_pct || 0) * 100).toFixed(1);
        
        logger.info(
          `  ${signal.coin} ${signal.direction.toUpperCase()} | ` +
          `${signal.elite_count}E + ${signal.good_count}G | ` +
          `${agreement}% agree | ` +
          `${strength} (${signal.confidence}%) | ` +
          `Stop: ${stopDist}%`
        );
      }
    }
    
    // Performance summary (if we have closed signals)
    if (perfSummary.totalSignals > 0) {
      logger.info('');
      logger.info('Signal Performance:');
      logger.info(`  Total: ${perfSummary.totalSignals} | Win Rate: ${(perfSummary.winRate * 100).toFixed(1)}%`);
      logger.info(`  Avg P&L: ${perfSummary.avgPnlPct >= 0 ? '+' : ''}${perfSummary.avgPnlPct.toFixed(2)}%`);
      logger.info(`  Total P&L: ${perfSummary.totalPnlPct >= 0 ? '+' : ''}${perfSummary.totalPnlPct.toFixed(2)}%`);
      if (perfSummary.bestSignal) {
        logger.info(`  Best: ${perfSummary.bestSignal.coin} +${perfSummary.bestSignal.pnl.toFixed(2)}%`);
      }
    }
    
    logger.info('-'.repeat(60));
    logger.info('');
  } catch (err) {
    logger.error('Status update failed', err);
  }
}

/**
 * Weekly full re-evaluation
 */
let lastFullReeval = 0;

async function checkWeeklyReeval(): Promise<void> {
  const now = Date.now();
  const weekMs = config.reeval.fullReevalIntervalHours * 60 * 60 * 1000;
  
  if (now - lastFullReeval >= weekMs) {
    logger.info('Running weekly full re-evaluation...');
    await reEvaluateAllTraders();
    await cleanupOldHistory();
    lastFullReeval = now;
  }
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('QUALITY TRADER SIGNAL SYSTEM V3');
  logger.info('='.repeat(60));
  logger.info('');
  logger.info('Features:');
  logger.info('  ✓ Directional agreement filter (65%+ consensus)');
  logger.info('  ✓ Actionable entry/stop/target levels');
  logger.info('  ✓ Signal performance tracking');
  logger.info('  ✓ Weekly trader re-evaluation');
  logger.info('  ✓ Enhanced confidence scoring');
  logger.info('');

  // Validate environment
  if (!process.env.SUPABASE_URL) {
    logger.error('Missing SUPABASE_URL');
    process.exit(1);
  }

  if (!process.env.SUPABASE_SERVICE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.error('Missing SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  // Check if we have traders to track
  const initialStats = await getQualityStats();

  if (initialStats.tracked === 0) {
    logger.warn('');
    logger.warn('No tracked traders found!');
    logger.warn('Please run the setup scripts first:');
    logger.warn('  1. npm run sync');
    logger.warn('  2. npm run analyze');
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
    // 1. Start position tracker (updates positions every 60s)
    logger.info('Starting position tracker...');
    startPositionTracker();

    // 2. Start signal performance tracker
    logger.info('Starting signal performance tracker...');
    startSignalTracker();

    // 3. Start periodic re-analysis (every 5 minutes)
    logger.info('Starting periodic re-analysis...');
    setInterval(reanalyzeQualityTraders, 5 * 60 * 1000);

    // 4. Check for weekly full re-evaluation (every hour)
    logger.info('Starting weekly re-evaluation checker...');
    setInterval(checkWeeklyReeval, 60 * 60 * 1000);

    // 5. Status logging every 5 minutes
    setInterval(logStatusUpdate, 5 * 60 * 1000);

    logger.info('');
    logger.info('System fully operational!');
    logger.info('');

    // Initial status after 10 seconds
    setTimeout(logStatusUpdate, 10000);

  } catch (error) {
    logger.error('Failed to start system', error);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('');
    logger.info('Shutting down...');
    stopPositionTracker();
    stopSignalTracker();
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