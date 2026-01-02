// Collector Entry Point V5 - Quality Trader Signal System
// Enhanced with:
// - Real-time WebSocket fill detection
// - Conviction scoring
// - Volatility-adjusted stops
// - Funding context awareness
// - Urgent re-evaluation triggers
// - Daily equity snapshots (built-in scheduler)

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createLogger } from './utils/logger.js';
import { startPositionTracker, stopPositionTracker, getPositionStats } from './processors/position-tracker.js';
import { getQualityStats, analyzeTrader, saveTraderAnalysis } from './processors/pnl-analyzer.js';
import { generateSignals, getActiveSignals, getHighConvictionSignals } from './processors/signal-generator.js';
import { startSignalTracker, stopSignalTracker, getPerformanceSummary } from './processors/signal-tracker.js';
import { reEvaluateAllTraders, cleanupOldHistory } from './processors/trader-reeval.js';
import { startWebSocketStream, stopWebSocketStream, getStreamStats, onFill } from './processors/websocket-stream.js';
import { startFundingTracker, stopFundingTracker } from './processors/funding-tracker.js';
import { startVolatilityTracker, stopVolatilityTracker } from './processors/volatility-tracker.js';
import db from './db/client.js';
import { config } from './config.js';

const logger = createLogger('main-v5');

// ============================================
// Types
// ============================================

interface HyperliquidClearinghouseState {
  marginSummary?: {
    accountValue?: string;
    totalMarginUsed?: string;
    totalNtlPos?: string;
    totalRawUsd?: string;
  };
  assetPositions?: Array<{
    position: {
      coin: string;
      szi: string;
      entryPx: string;
      positionValue: string;
      unrealizedPnl: string;
      leverage: {
        type: string;
        value: number;
      };
    };
  }>;
}

// ============================================
// Real-time Fill Handler
// ============================================

/**
 * Handle real-time fills from WebSocket
 * Triggers immediate signal regeneration for quality trader fills
 */
async function handleRealtimeFill(fill: {
  address: string;
  coin: string;
  side: 'buy' | 'sell';
  size: number;
  price: number;
  closedPnl: number;
  qualityTier?: 'elite' | 'good';
}): Promise<void> {
  // Only care about quality trader fills
  if (!fill.qualityTier) return;

  const value = fill.size * fill.price;
  
  // Log significant fills
  if (value >= 10000 || fill.qualityTier === 'elite') {
    logger.info(
      `🔔 LIVE ${fill.qualityTier.toUpperCase()} FILL: ` +
      `${fill.address.slice(0, 8)}... ${fill.side.toUpperCase()} ` +
      `${fill.coin} $${value.toFixed(0)} @ $${fill.price.toFixed(2)}`
    );
  }

  // Trigger signal regeneration for large fills
  if (value >= 25000) {
    logger.info('Triggering signal regeneration...');
    await generateSignals();
  }

  // Create alert for new elite entries
  if (fill.qualityTier === 'elite' && fill.closedPnl === 0 && value >= 10000) {
    try {
      await db.client.from('signal_alerts').insert({
        coin: fill.coin,
        direction: fill.side === 'buy' ? 'long' : 'short',
        alert_type: 'elite_entry',
        message: `Elite trader entered ${fill.coin} ${fill.side} position ($${value.toFixed(0)})`,
      });
    } catch (error) {
      // Ignore errors
    }
  }
}

// ============================================
// Daily Equity Snapshot Scheduler
// ============================================

let lastEquitySnapshotDate = '';

/**
 * Check if we need to run daily equity snapshots
 * Runs once per day at first check after midnight UTC
 */
async function checkDailyEquitySnapshot(): Promise<void> {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  // Already ran today
  if (lastEquitySnapshotDate === today) return;
  
  // Check if we already have snapshots for today in the database
  const { data: existingSnapshots } = await db.client
    .from('trader_equity_history')
    .select('id')
    .eq('snapshot_date', today)
    .limit(1);
  
  if (existingSnapshots && existingSnapshots.length > 0) {
    logger.info(`📊 Equity snapshots already exist for ${today}, skipping`);
    lastEquitySnapshotDate = today;
    return;
  }
  
  // Run the snapshot
  logger.info('');
  logger.info('='.repeat(50));
  logger.info(`📊 DAILY EQUITY SNAPSHOT - ${today}`);
  logger.info('='.repeat(50));
  
  await saveAllEquitySnapshots();
  lastEquitySnapshotDate = today;
}

/**
 * Save equity snapshots for all tracked traders
 */
async function saveAllEquitySnapshots(): Promise<void> {
  try {
    // Get all tracked traders
    const { data: traders, error: tradersError } = await db.client
      .from('trader_quality')
      .select('address')
      .eq('is_tracked', true);
    
    if (tradersError || !traders) {
      logger.error('Failed to fetch traders:', tradersError);
      return;
    }
    
    logger.info(`Processing ${traders.length} tracked traders...`);
    
    const today = new Date().toISOString().split('T')[0];
    let saved = 0;
    let failed = 0;
    
    for (const trader of traders) {
      try {
        // Fetch current account state from Hyperliquid
        const response = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'clearinghouseState',
            user: trader.address
          })
        });
        
        if (!response.ok) {
          failed++;
          continue;
        }
        
        // Type the response properly
        const state = await response.json() as HyperliquidClearinghouseState;
        const accountValue = parseFloat(state.marginSummary?.accountValue || '0');
        
        if (accountValue <= 0) {
          continue; // Skip empty accounts
        }
        
        // Save snapshot with all required fields
        const { error: insertError } = await db.client
          .from('trader_equity_history')
          .upsert({
            address: trader.address,
            snapshot_date: today,
            account_value: accountValue,
            peak_value: accountValue,
            drawdown_pct: 0,
            daily_pnl: 0,
            daily_roi_pct: 0,
            trades_count: 0,
            wins_count: 0,
            losses_count: 0,
          }, {
            onConflict: 'address,snapshot_date'
          });
        
        if (insertError) {
          logger.error(`Failed to save snapshot for ${trader.address.slice(0, 8)}:`, insertError);
          failed++;
        } else {
          saved++;
        }
        
        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (err) {
        failed++;
      }
    }
    
    logger.info(`✅ Equity snapshots complete: ${saved} saved, ${failed} failed`);
    
    // Log how many days of history we have
    const { data: dateCount } = await db.client
      .from('trader_equity_history')
      .select('snapshot_date')
      .limit(1000);
    
    if (dateCount) {
      const uniqueDates = new Set(dateCount.map(d => d.snapshot_date));
      logger.info(`📈 Total equity history: ${uniqueDates.size} days`);
      
      if (uniqueDates.size < 7) {
        logger.info(`⏳ Need ${7 - uniqueDates.size} more days for accurate P&L calculation`);
      } else {
        logger.info(`✅ Equity-based P&L calculation is now active!`);
      }
    }
    
  } catch (error) {
    logger.error('Equity snapshot failed:', error);
  }
}

// ============================================
// Periodic Tasks
// ============================================

async function reanalyzeQualityTraders(): Promise<void> {
  try {
    const now = new Date();

    const eliteResult = await db.client
      .from('trader_quality')
      .select('address')
      .eq('quality_tier', 'elite')
      .lt('analyzed_at', new Date(now.getTime() - config.analysis.reanalyzeEliteHours * 60 * 60 * 1000).toISOString())
      .limit(10);

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
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  } catch (error) {
    logger.error('Re-analysis failed', error);
  }
}

async function logStatusUpdate(): Promise<void> {
  try {
    const qualityStats = await getQualityStats();
    const positionStats = await getPositionStats();
    const activeSignals = await getActiveSignals();
    const perfSummary = await getPerformanceSummary();
    const streamStats = getStreamStats();

    logger.info('');
    logger.info('-'.repeat(70));
    logger.info('STATUS UPDATE V5');
    logger.info('-'.repeat(70));
    
    // Quality traders
    logger.info(
      `Quality Traders: ${qualityStats.elite} Elite | ${qualityStats.good} Good | ` +
      `${qualityStats.tracked} Tracked`
    );
    
    // Positions
    logger.info(
      `Positions: ${positionStats.totalPositions} total | ` +
      `${positionStats.uniqueCoins} coins | ` +
      `${positionStats.withStopOrders || 0} with stops`
    );
    
    // WebSocket status
    logger.info(
      `WebSocket: ${streamStats.isConnected ? '🟢 Connected' : '🔴 Disconnected'} | ` +
      `${streamStats.subscribedCount} subscribed | ` +
      `${streamStats.fillsReceived} fills received`
    );
    
    // Active signals
    logger.info(`Active Signals: ${activeSignals.length}`);
    
    if (activeSignals.length > 0) {
      logger.info('');
      logger.info('Current Signals:');
      for (const signal of activeSignals.slice(0, 5) as any[]) {
        const strength = signal.signal_strength === 'strong' ? '🔥 STRONG' : '📊 MEDIUM';
        const agreement = ((signal.directional_agreement || 0) * 100).toFixed(0);
        const stopDist = ((signal.stop_distance_pct || 0)).toFixed(1);
        const conviction = (signal.avg_conviction_pct || 0).toFixed(0);
        const fundingEmoji = signal.funding_context === 'favorable' ? '✅' : 
                           signal.funding_context === 'unfavorable' ? '⚠️' : '';
        
        logger.info(
          `  ${signal.coin} ${signal.direction.toUpperCase()} | ` +
          `${signal.elite_count}E + ${signal.good_count}G | ` +
          `${agreement}% agree | ` +
          `${conviction}% conv | ` +
          `${signal.funding_context}${fundingEmoji} | ` +
          `Stop: ${stopDist}% | ` +
          `${strength} (${signal.confidence}%)`
        );
      }
    }

    // High conviction signals
    const highConviction = await getHighConvictionSignals(25);
    if (highConviction.length > 0) {
      logger.info('');
      logger.info(`💪 High Conviction Signals: ${highConviction.length}`);
      for (const sig of highConviction.slice(0, 3) as any[]) {
        logger.info(`  ${sig.coin} ${sig.direction} - ${sig.avg_conviction_pct.toFixed(0)}% avg conviction`);
      }
    }
    
    // Performance summary
    if (perfSummary.totalSignals > 0) {
      logger.info('');
      logger.info('Signal Performance:');
      logger.info(`  Total: ${perfSummary.totalSignals} | Win Rate: ${(perfSummary.winRate * 100).toFixed(1)}%`);
      logger.info(`  Avg P&L: ${perfSummary.avgPnlPct >= 0 ? '+' : ''}${perfSummary.avgPnlPct.toFixed(2)}%`);
      logger.info(`  Total P&L: ${perfSummary.totalPnlPct >= 0 ? '+' : ''}${perfSummary.totalPnlPct.toFixed(2)}%`);
    }
    
    logger.info('-'.repeat(70));
    logger.info('');
  } catch (err) {
    logger.error('Status update failed', err);
  }
}

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
  logger.info('='.repeat(70));
  logger.info('QUALITY TRADER SIGNAL SYSTEM V5');
  logger.info('='.repeat(70));
  logger.info('');
  logger.info('V5 Features:');
  logger.info('  ✓ Real-time WebSocket fill detection');
  logger.info('  ✓ Position conviction scoring (% of account)');
  logger.info('  ✓ Volatility-adjusted stops (ATR-based)');
  logger.info('  ✓ Funding rate context (favorable/unfavorable)');
  logger.info('  ✓ Open order awareness (see entries before fills)');
  logger.info('  ✓ Urgent re-evaluation triggers (rapid demotion)');
  logger.info('  ✓ Daily equity snapshots (automatic)');
  logger.info('  ✓ Equity-based P&L calculation (after 7 days)');
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

  // Check traders
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
    // 1. Start volatility tracker first (needed for signal generation)
    logger.info('Starting volatility tracker...');
    startVolatilityTracker();
    
    // 2. Start funding tracker
    logger.info('Starting funding tracker...');
    startFundingTracker();
    
    // Wait a bit for initial data
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 3. Start position tracker
    logger.info('Starting position tracker V5...');
    startPositionTracker();

    // 4. Start signal performance tracker
    logger.info('Starting signal performance tracker...');
    startSignalTracker();

    // 5. Start WebSocket stream for real-time fills
    if (config.websocket?.enabled !== false) {
      logger.info('Starting WebSocket stream...');
      startWebSocketStream();
      
      // Register fill handler
      onFill(handleRealtimeFill);
    }

    // 6. Start periodic re-analysis
    logger.info('Starting periodic re-analysis...');
    setInterval(reanalyzeQualityTraders, 5 * 60 * 1000);

    // 7. Weekly re-evaluation check
    logger.info('Starting weekly re-evaluation checker...');
    setInterval(checkWeeklyReeval, 60 * 60 * 1000);

    // 8. Status logging every 5 minutes
    setInterval(logStatusUpdate, 5 * 60 * 1000);

    // 9. Daily equity snapshot checker (runs every hour, triggers once per day)
    logger.info('Starting daily equity snapshot scheduler...');
    setInterval(checkDailyEquitySnapshot, 60 * 60 * 1000); // Check every hour
    
    // Run equity snapshot check immediately on startup
    await checkDailyEquitySnapshot();

    logger.info('');
    logger.info('System fully operational!');
    logger.info('');

    // Initial status after 15 seconds (let data populate)
    setTimeout(logStatusUpdate, 15000);

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
    stopWebSocketStream();
    stopFundingTracker();
    stopVolatilityTracker();
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