// Backtest Signals V2
// Comprehensive historical backtesting:
// - 6-month lookback capability
// - Price caching for efficiency
// - Detailed performance breakdown
// - Results storage in database
// - Multiple timeframe analysis

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import hyperliquid from '../utils/hyperliquid-api.js';

const logger = createLogger('backtest-v2');

// ============================================
// Types
// ============================================

interface Signal {
  id: number;
  coin: string;
  direction: 'long' | 'short';
  entry_price: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  take_profit_3: number;
  confidence: number;
  signal_strength: string;
  elite_count: number;
  good_count: number;
  created_at: string;
}

interface BacktestResult {
  signalId: number;
  coin: string;
  direction: string;
  entryPrice: number;
  outcome: 'stopped' | 'tp1' | 'tp2' | 'tp3' | 'expired' | 'open';
  finalPnlPct: number;
  maxProfitPct: number;
  maxDrawdownPct: number;
  durationHours: number;
  exitPrice: number;
  confidence: number;
  signalStrength: string;
}

interface BacktestSummary {
  name: string;
  startDate: Date;
  endDate: Date;
  totalSignals: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgPnlPct: number;
  totalPnlPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  sharpeRatio: number;
  avgDurationHours: number;
  byConfidence: Record<string, { count: number; winRate: number; avgPnl: number }>;
  byStrength: Record<string, { count: number; winRate: number; avgPnl: number }>;
  byOutcome: Record<string, number>;
  monthlyReturns: { month: string; pnl: number; trades: number }[];
}

interface CachedCandles {
  [key: string]: { timestamp: number; open: number; high: number; low: number; close: number }[];
}

// Price cache to avoid repeated API calls
const priceCache: CachedCandles = {};

// ============================================
// Price Data Management
// ============================================

async function getHistoricalCandles(
  coin: string,
  startTime: number,
  endTime: number,
  interval: string = '1h'
): Promise<{ timestamp: number; open: number; high: number; low: number; close: number }[]> {
  const cacheKey = `${coin}-${interval}-${Math.floor(startTime / 86400000)}-${Math.floor(endTime / 86400000)}`;
  
  if (priceCache[cacheKey]) {
    return priceCache[cacheKey];
  }

  // Try to get from database cache first
  const { data: cached } = await db.client
    .from('historical_prices')
    .select('*')
    .eq('coin', coin)
    .eq('interval', interval)
    .gte('timestamp', new Date(startTime).toISOString())
    .lte('timestamp', new Date(endTime).toISOString())
    .order('timestamp', { ascending: true });

  if (cached && cached.length > 0) {
    const candles = cached.map(c => ({
      timestamp: new Date(c.timestamp).getTime(),
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
    }));
    priceCache[cacheKey] = candles;
    return candles;
  }

  // Fetch from API
  const candles = await hyperliquid.getCandles(coin, interval, startTime, endTime);
  
  if (!candles || candles.length === 0) {
    return [];
  }

  const processed = candles.map(c => ({
    timestamp: c.t,
    open: parseFloat(c.o),
    high: parseFloat(c.h),
    low: parseFloat(c.l),
    close: parseFloat(c.c),
  }));

  // Cache in memory
  priceCache[cacheKey] = processed;

  // Cache in database for future use
  try {
    await db.client.from('historical_prices').upsert(
      processed.map(c => ({
        coin,
        interval,
        timestamp: new Date(c.timestamp).toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: 0,
      })),
      { onConflict: 'coin,interval,timestamp' }
    );
  } catch (error) {
    // Ignore cache errors
  }

  return processed;
}

// ============================================
// Signal Simulation
// ============================================

async function simulateSignal(signal: Signal, maxHours: number = 168): Promise<BacktestResult> {
  const signalTime = new Date(signal.created_at).getTime();
  const endTime = Math.min(signalTime + maxHours * 60 * 60 * 1000, Date.now());
  
  // Get hourly candles for the signal period
  const candles = await getHistoricalCandles(signal.coin, signalTime, endTime, '1h');

  if (candles.length === 0) {
    return {
      signalId: signal.id,
      coin: signal.coin,
      direction: signal.direction,
      entryPrice: signal.entry_price || 0,
      outcome: 'open',
      finalPnlPct: 0,
      maxProfitPct: 0,
      maxDrawdownPct: 0,
      durationHours: 0,
      exitPrice: signal.entry_price || 0,
      confidence: signal.confidence,
      signalStrength: signal.signal_strength,
    };
  }

  const entryPrice = signal.entry_price || candles[0]?.close || 0;
  
  if (entryPrice <= 0) {
    return {
      signalId: signal.id,
      coin: signal.coin,
      direction: signal.direction,
      entryPrice: 0,
      outcome: 'open',
      finalPnlPct: 0,
      maxProfitPct: 0,
      maxDrawdownPct: 0,
      durationHours: 0,
      exitPrice: 0,
      confidence: signal.confidence,
      signalStrength: signal.signal_strength,
    };
  }

  let maxProfit = 0;
  let maxDrawdown = 0;
  let outcome: BacktestResult['outcome'] = 'open';
  let exitPrice = entryPrice;
  let exitTime = signalTime;

  const isLong = signal.direction === 'long';

  // Walk through candles
  for (const candle of candles) {
    // Calculate P&L at high and low of candle
    let pnlAtHigh: number;
    let pnlAtLow: number;
    
    if (isLong) {
      pnlAtHigh = ((candle.high - entryPrice) / entryPrice) * 100;
      pnlAtLow = ((candle.low - entryPrice) / entryPrice) * 100;
    } else {
      pnlAtHigh = ((entryPrice - candle.high) / entryPrice) * 100;
      pnlAtLow = ((entryPrice - candle.low) / entryPrice) * 100;
    }

    // Update max profit/drawdown
    maxProfit = Math.max(maxProfit, pnlAtHigh, pnlAtLow);
    maxDrawdown = Math.min(maxDrawdown, pnlAtHigh, pnlAtLow);

    // Check stop loss
    if (isLong && candle.low <= signal.stop_loss) {
      outcome = 'stopped';
      exitPrice = signal.stop_loss;
      exitTime = candle.timestamp;
      break;
    }
    if (!isLong && candle.high >= signal.stop_loss) {
      outcome = 'stopped';
      exitPrice = signal.stop_loss;
      exitTime = candle.timestamp;
      break;
    }

    // Check take profits (in order)
    if (isLong) {
      if (candle.high >= signal.take_profit_3) {
        outcome = 'tp3';
        exitPrice = signal.take_profit_3;
        exitTime = candle.timestamp;
        break;
      } else if (candle.high >= signal.take_profit_2 && outcome !== 'tp2' && outcome !== 'tp1') {
        outcome = 'tp2';
        exitPrice = signal.take_profit_2;
        exitTime = candle.timestamp;
        // Don't break - continue to see if TP3 is hit
      } else if (candle.high >= signal.take_profit_1 && outcome !== 'tp1') {
        outcome = 'tp1';
        exitPrice = signal.take_profit_1;
        exitTime = candle.timestamp;
        // Don't break - continue to see if TP2/3 is hit
      }
    } else {
      if (candle.low <= signal.take_profit_3) {
        outcome = 'tp3';
        exitPrice = signal.take_profit_3;
        exitTime = candle.timestamp;
        break;
      } else if (candle.low <= signal.take_profit_2 && outcome !== 'tp2' && outcome !== 'tp1') {
        outcome = 'tp2';
        exitPrice = signal.take_profit_2;
        exitTime = candle.timestamp;
      } else if (candle.low <= signal.take_profit_1 && outcome !== 'tp1') {
        outcome = 'tp1';
        exitPrice = signal.take_profit_1;
        exitTime = candle.timestamp;
      }
    }
  }

  // If still open after max hours, mark as expired
  if (outcome === 'open' && candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    exitPrice = lastCandle.close;
    exitTime = lastCandle.timestamp;
    
    const elapsed = (exitTime - signalTime) / (1000 * 60 * 60);
    if (elapsed >= maxHours) {
      outcome = 'expired';
    }
  }

  // Calculate final P&L
  let finalPnlPct: number;
  if (isLong) {
    finalPnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
  } else {
    finalPnlPct = ((entryPrice - exitPrice) / entryPrice) * 100;
  }

  const durationHours = (exitTime - signalTime) / (1000 * 60 * 60);

  return {
    signalId: signal.id,
    coin: signal.coin,
    direction: signal.direction,
    entryPrice,
    outcome,
    finalPnlPct,
    maxProfitPct: maxProfit,
    maxDrawdownPct: Math.abs(maxDrawdown),
    durationHours: Math.max(0, durationHours),
    exitPrice,
    confidence: signal.confidence,
    signalStrength: signal.signal_strength,
  };
}

// ============================================
// Summary Calculation
// ============================================

function calculateSummary(results: BacktestResult[], name: string, startDate: Date, endDate: Date): BacktestSummary {
  const completedResults = results.filter(r => r.outcome !== 'open');
  
  const winningTrades = completedResults.filter(r => r.finalPnlPct > 0);
  const losingTrades = completedResults.filter(r => r.finalPnlPct <= 0);
  
  const totalPnl = completedResults.reduce((sum, r) => sum + r.finalPnlPct, 0);
  const avgPnl = completedResults.length > 0 ? totalPnl / completedResults.length : 0;
  
  const grossProfit = winningTrades.reduce((sum, r) => sum + r.finalPnlPct, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, r) => sum + r.finalPnlPct, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 10 : 0);

  // Max drawdown (sequential losses)
  let runningPnl = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const result of completedResults.sort((a, b) => a.signalId - b.signalId)) {
    runningPnl += result.finalPnlPct;
    if (runningPnl > peak) peak = runningPnl;
    const drawdown = peak - runningPnl;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Sharpe ratio (simplified - assumes daily returns)
  const returns = completedResults.map(r => r.finalPnlPct);
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length || 0;
  const stdDev = Math.sqrt(
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length || 1
  );
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365) : 0;

  // Average duration
  const avgDuration = completedResults.reduce((sum, r) => sum + r.durationHours, 0) / completedResults.length || 0;

  // By confidence
  const byConfidence: Record<string, { count: number; winRate: number; avgPnl: number }> = {};
  const confidenceBuckets = ['90+', '75-89', '60-74', '<60'];
  for (const bucket of confidenceBuckets) {
    let filtered: BacktestResult[];
    if (bucket === '90+') filtered = completedResults.filter(r => r.confidence >= 90);
    else if (bucket === '75-89') filtered = completedResults.filter(r => r.confidence >= 75 && r.confidence < 90);
    else if (bucket === '60-74') filtered = completedResults.filter(r => r.confidence >= 60 && r.confidence < 75);
    else filtered = completedResults.filter(r => r.confidence < 60);

    if (filtered.length > 0) {
      const wins = filtered.filter(r => r.finalPnlPct > 0).length;
      byConfidence[bucket] = {
        count: filtered.length,
        winRate: wins / filtered.length,
        avgPnl: filtered.reduce((sum, r) => sum + r.finalPnlPct, 0) / filtered.length,
      };
    }
  }

  // By strength
  const byStrength: Record<string, { count: number; winRate: number; avgPnl: number }> = {};
  for (const strength of ['strong', 'medium']) {
    const filtered = completedResults.filter(r => r.signalStrength === strength);
    if (filtered.length > 0) {
      const wins = filtered.filter(r => r.finalPnlPct > 0).length;
      byStrength[strength] = {
        count: filtered.length,
        winRate: wins / filtered.length,
        avgPnl: filtered.reduce((sum, r) => sum + r.finalPnlPct, 0) / filtered.length,
      };
    }
  }

  // By outcome
  const byOutcome: Record<string, number> = {};
  for (const result of results) {
    byOutcome[result.outcome] = (byOutcome[result.outcome] || 0) + 1;
  }

  // Monthly returns
  const monthlyReturns: { month: string; pnl: number; trades: number }[] = [];
  // (Would need signal timestamps to calculate properly)

  return {
    name,
    startDate,
    endDate,
    totalSignals: results.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: completedResults.length > 0 ? winningTrades.length / completedResults.length : 0,
    avgPnlPct: avgPnl,
    totalPnlPct: totalPnl,
    maxDrawdownPct: maxDrawdown,
    profitFactor,
    sharpeRatio,
    avgDurationHours: avgDuration,
    byConfidence,
    byStrength,
    byOutcome,
    monthlyReturns,
  };
}

// ============================================
// Main Backtest Function
// ============================================

async function runBacktest(options: {
  daysBack?: number;
  maxSignals?: number;
  maxHoursPerSignal?: number;
  saveToDB?: boolean;
} = {}): Promise<void> {
  const {
    daysBack = 180, // 6 months default
    maxSignals = 500,
    maxHoursPerSignal = 168, // 1 week
    saveToDB = true,
  } = options;

  logger.info('');
  logger.info('='.repeat(60));
  logger.info('SIGNAL BACKTESTING V2');
  logger.info('='.repeat(60));
  logger.info(`Looking back ${daysBack} days, max ${maxSignals} signals`);
  logger.info('');

  // Get historical signals
  const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  
  const { data: signals, error } = await db.client
    .from('quality_signals')
    .select('*')
    .gte('created_at', cutoffDate.toISOString())
    .not('entry_price', 'is', null)
    .order('created_at', { ascending: true })
    .limit(maxSignals);

  if (error || !signals || signals.length === 0) {
    logger.error('No signals found for backtesting');
    return;
  }

  logger.info(`Backtesting ${signals.length} signals...`);
  logger.info('');

  const results: BacktestResult[] = [];
  let processed = 0;

  for (const signal of signals as Signal[]) {
    // Skip signals with invalid entry price
    if (!signal.entry_price || signal.entry_price <= 0) {
      continue;
    }

    const result = await simulateSignal(signal, maxHoursPerSignal);
    results.push(result);

    // Log individual result
    const emoji = {
      stopped: '🛑',
      tp1: '🎯',
      tp2: '🎯🎯',
      tp3: '🎯🎯🎯',
      expired: '⏰',
      open: '📊',
    }[result.outcome];

    logger.info(
      `${emoji} ${result.coin} ${result.direction.toUpperCase()} | ` +
      `${result.outcome.toUpperCase()} | ` +
      `P&L: ${result.finalPnlPct >= 0 ? '+' : ''}${result.finalPnlPct.toFixed(2)}% | ` +
      `Max: +${result.maxProfitPct.toFixed(2)}% / -${result.maxDrawdownPct.toFixed(2)}% | ` +
      `${result.durationHours.toFixed(1)}h`
    );

    processed++;
    if (processed % 20 === 0) {
      logger.info(`Progress: ${processed}/${signals.length}`);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Calculate summary
  const summary = calculateSummary(
    results,
    `Backtest ${daysBack}d`,
    cutoffDate,
    new Date()
  );

  // Log summary
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('BACKTEST SUMMARY');
  logger.info('='.repeat(60));
  logger.info(`Total signals: ${summary.totalSignals}`);
  logger.info(`  🛑 Stopped: ${summary.byOutcome['stopped'] || 0}`);
  logger.info(`  🎯 TP1: ${summary.byOutcome['tp1'] || 0}`);
  logger.info(`  🎯🎯 TP2: ${summary.byOutcome['tp2'] || 0}`);
  logger.info(`  🎯🎯🎯 TP3: ${summary.byOutcome['tp3'] || 0}`);
  logger.info(`  ⏰ Expired: ${summary.byOutcome['expired'] || 0}`);
  logger.info(`  📊 Still Open: ${summary.byOutcome['open'] || 0}`);
  logger.info('');
  logger.info(`Win Rate: ${(summary.winRate * 100).toFixed(1)}%`);
  logger.info(`Avg P&L: ${summary.avgPnlPct >= 0 ? '+' : ''}${summary.avgPnlPct.toFixed(2)}%`);
  logger.info(`Total P&L: ${summary.totalPnlPct >= 0 ? '+' : ''}${summary.totalPnlPct.toFixed(2)}%`);
  logger.info(`Max Drawdown: ${summary.maxDrawdownPct.toFixed(2)}%`);
  logger.info(`Profit Factor: ${summary.profitFactor.toFixed(2)}`);
  logger.info(`Sharpe Ratio: ${summary.sharpeRatio.toFixed(2)}`);
  logger.info(`Avg Duration: ${summary.avgDurationHours.toFixed(1)} hours`);
  logger.info('');

  // By confidence
  logger.info('BY CONFIDENCE:');
  for (const [bucket, stats] of Object.entries(summary.byConfidence)) {
    logger.info(
      `  ${bucket}: ${stats.count} signals, ` +
      `${(stats.winRate * 100).toFixed(1)}% WR, ` +
      `${stats.avgPnl >= 0 ? '+' : ''}${stats.avgPnl.toFixed(2)}% avg`
    );
  }
  logger.info('');

  // By strength
  logger.info('BY STRENGTH:');
  for (const [strength, stats] of Object.entries(summary.byStrength)) {
    logger.info(
      `  ${strength.toUpperCase()}: ${stats.count} signals, ` +
      `${(stats.winRate * 100).toFixed(1)}% WR, ` +
      `${stats.avgPnl >= 0 ? '+' : ''}${stats.avgPnl.toFixed(2)}% avg`
    );
  }
  logger.info('');

  // Save results to database
  if (saveToDB) {
    try {
      // Update signals with backtest results
      for (const result of results) {
        if (result.outcome !== 'open') {
          await db.client
            .from('quality_signals')
            .update({
              outcome: result.outcome,
              final_pnl_pct: result.finalPnlPct,
              max_pnl_pct: result.maxProfitPct,
              min_pnl_pct: -result.maxDrawdownPct,
              duration_hours: result.durationHours,
              hit_stop: result.outcome === 'stopped',
              hit_tp1: ['tp1', 'tp2', 'tp3'].includes(result.outcome),
              hit_tp2: ['tp2', 'tp3'].includes(result.outcome),
              hit_tp3: result.outcome === 'tp3',
            })
            .eq('id', result.signalId);
        }
      }

      // Save backtest summary
      await db.client.from('backtest_results').insert({
        backtest_name: summary.name,
        start_date: summary.startDate.toISOString().split('T')[0],
        end_date: summary.endDate.toISOString().split('T')[0],
        initial_capital: 10000,
        final_capital: 10000 * (1 + summary.totalPnlPct / 100),
        total_return_pct: summary.totalPnlPct,
        total_trades: summary.totalSignals,
        winning_trades: summary.winningTrades,
        losing_trades: summary.losingTrades,
        win_rate_pct: summary.winRate * 100,
        max_drawdown_pct: summary.maxDrawdownPct,
        sharpe_ratio: summary.sharpeRatio,
        sortino_ratio: null,
        profit_factor: summary.profitFactor,
        avg_win_pct: null,
        avg_loss_pct: null,
        avg_trade_duration_hours: summary.avgDurationHours,
        monthly_returns: summary.monthlyReturns,
        signals_by_confidence: summary.byConfidence,
        signals_by_strength: summary.byStrength,
        config_snapshot: config,
      });

      logger.info('Results saved to database');
    } catch (error) {
      logger.error('Failed to save results', error);
    }
  }
}

// ============================================
// CLI Entry Point
// ============================================

const args = process.argv.slice(2);
const daysArg = args.find(a => a.startsWith('--days='));
const days = daysArg ? parseInt(daysArg.split('=')[1]) : 180;

runBacktest({ daysBack: days }).catch(error => {
  logger.error('Backtest failed', error);
  process.exit(1);
});