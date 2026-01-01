// Backtest Signals Script
// Runs historical analysis on past signals to validate performance
// Usage: npx tsx src/scripts/backtest-signals.ts

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import hyperliquid from '../utils/hyperliquid-api.js';
import { config } from '../config.js';

const logger = createLogger('backtest');

// ============================================
// Types
// ============================================

interface SignalToBacktest {
  id: number;
  coin: string;
  direction: 'long' | 'short';
  entry_price: number;
  suggested_entry: number;
  stop_loss: number;
  stop_distance_pct: number;
  take_profit_1: number;
  take_profit_2: number;
  take_profit_3: number;
  elite_count: number;
  good_count: number;
  confidence: number;
  created_at: string;
  outcome: string | null;
}

interface BacktestResult {
  signal_id: number;
  coin: string;
  direction: string;
  outcome: 'stopped' | 'tp1' | 'tp2' | 'tp3' | 'open' | 'expired';
  pnl_pct: number;
  max_profit_pct: number;
  max_drawdown_pct: number;
  duration_hours: number;
  hit_time: Date | null;
}

// ============================================
// Backtesting Logic
// ============================================

async function backtestSignal(signal: SignalToBacktest): Promise<BacktestResult | null> {
  try {
    const entryPrice = signal.entry_price || signal.suggested_entry;
    const createdAt = new Date(signal.created_at).getTime();
    const now = Date.now();
    
    // Fetch hourly candles from signal creation to now
    const candles = await hyperliquid.getCandles(
      signal.coin,
      '1h',
      createdAt,
      now
    );

    if (!candles || candles.length === 0) {
      logger.warn(`No candles for ${signal.coin}`);
      return null;
    }

    let maxProfitPct = 0;
    let maxDrawdownPct = 0;
    let outcome: BacktestResult['outcome'] = 'open';
    let hitTime: Date | null = null;
    let exitPnlPct = 0;

    for (const candle of candles) {
      const high = parseFloat(candle.h);
      const low = parseFloat(candle.l);
      const close = parseFloat(candle.c);
      const candleTime = new Date(candle.t);

      // Calculate P&L at high and low
      let pnlAtHigh: number;
      let pnlAtLow: number;

      if (signal.direction === 'long') {
        pnlAtHigh = ((high - entryPrice) / entryPrice) * 100;
        pnlAtLow = ((low - entryPrice) / entryPrice) * 100;
      } else {
        pnlAtHigh = ((entryPrice - high) / entryPrice) * 100;
        pnlAtLow = ((entryPrice - low) / entryPrice) * 100;
      }

      // Track max profit and drawdown
      maxProfitPct = Math.max(maxProfitPct, pnlAtHigh, pnlAtLow);
      maxDrawdownPct = Math.min(maxDrawdownPct, pnlAtHigh, pnlAtLow);

      // Check stop loss
      if (signal.direction === 'long') {
        if (low <= signal.stop_loss) {
          outcome = 'stopped';
          exitPnlPct = -signal.stop_distance_pct;
          hitTime = candleTime;
          break;
        }
      } else {
        if (high >= signal.stop_loss) {
          outcome = 'stopped';
          exitPnlPct = -signal.stop_distance_pct;
          hitTime = candleTime;
          break;
        }
      }

      // Check take profits (in order: TP3 > TP2 > TP1)
      if (signal.direction === 'long') {
        if (high >= signal.take_profit_3) {
          outcome = 'tp3';
          exitPnlPct = ((signal.take_profit_3 - entryPrice) / entryPrice) * 100;
          hitTime = candleTime;
          break;
        } else if (high >= signal.take_profit_2) {
          outcome = 'tp2';
          exitPnlPct = ((signal.take_profit_2 - entryPrice) / entryPrice) * 100;
          hitTime = candleTime;
          break;
        } else if (high >= signal.take_profit_1) {
          outcome = 'tp1';
          exitPnlPct = ((signal.take_profit_1 - entryPrice) / entryPrice) * 100;
          hitTime = candleTime;
          break;
        }
      } else {
        if (low <= signal.take_profit_3) {
          outcome = 'tp3';
          exitPnlPct = ((entryPrice - signal.take_profit_3) / entryPrice) * 100;
          hitTime = candleTime;
          break;
        } else if (low <= signal.take_profit_2) {
          outcome = 'tp2';
          exitPnlPct = ((entryPrice - signal.take_profit_2) / entryPrice) * 100;
          hitTime = candleTime;
          break;
        } else if (low <= signal.take_profit_1) {
          outcome = 'tp1';
          exitPnlPct = ((entryPrice - signal.take_profit_1) / entryPrice) * 100;
          hitTime = candleTime;
          break;
        }
      }
    }

    // If still open, check if expired
    const durationHours = (now - createdAt) / (1000 * 60 * 60);
    if (outcome === 'open' && durationHours >= config.signalTracking.maxSignalHours) {
      outcome = 'expired';
      const lastCandle = candles[candles.length - 1];
      const lastClose = parseFloat(lastCandle.c);
      if (signal.direction === 'long') {
        exitPnlPct = ((lastClose - entryPrice) / entryPrice) * 100;
      } else {
        exitPnlPct = ((entryPrice - lastClose) / entryPrice) * 100;
      }
    }

    // If still open, calculate current P&L
    if (outcome === 'open') {
      const lastCandle = candles[candles.length - 1];
      const lastClose = parseFloat(lastCandle.c);
      if (signal.direction === 'long') {
        exitPnlPct = ((lastClose - entryPrice) / entryPrice) * 100;
      } else {
        exitPnlPct = ((entryPrice - lastClose) / entryPrice) * 100;
      }
    }

    return {
      signal_id: signal.id,
      coin: signal.coin,
      direction: signal.direction,
      outcome,
      pnl_pct: exitPnlPct,
      max_profit_pct: maxProfitPct,
      max_drawdown_pct: maxDrawdownPct,
      duration_hours: hitTime 
        ? (hitTime.getTime() - createdAt) / (1000 * 60 * 60)
        : durationHours,
      hit_time: hitTime,
    };

  } catch (error) {
    logger.error(`Backtest failed for signal ${signal.id}`, error);
    return null;
  }
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('SIGNAL BACKTESTING');
  logger.info('='.repeat(60));
  logger.info('');

  // Get all signals that haven't been backtested yet
  const { data: signals, error } = await db.client
    .from('quality_signals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !signals || signals.length === 0) {
    logger.info('No signals to backtest');
    return;
  }

  logger.info(`Backtesting ${signals.length} signals...`);
  logger.info('');

  const results: BacktestResult[] = [];
  let processed = 0;

  for (const signal of signals) {
    const result = await backtestSignal(signal as SignalToBacktest);
    
    if (result) {
      results.push(result);

      // Update signal in database with backtest results
      await db.client
        .from('quality_signals')
        .update({
          outcome: result.outcome,
          final_pnl_pct: result.pnl_pct,
          max_pnl_pct: result.max_profit_pct,
          min_pnl_pct: result.max_drawdown_pct,
          duration_hours: result.duration_hours,
          hit_stop: result.outcome === 'stopped',
          hit_tp1: ['tp1', 'tp2', 'tp3'].includes(result.outcome),
          hit_tp2: ['tp2', 'tp3'].includes(result.outcome),
          hit_tp3: result.outcome === 'tp3',
          is_active: result.outcome === 'open',
          closed_at: result.outcome !== 'open' ? result.hit_time?.toISOString() : null,
        })
        .eq('id', signal.id);

      const emoji = result.outcome === 'stopped' ? '🛑' :
                    result.outcome === 'tp3' ? '🎯🎯🎯' :
                    result.outcome === 'tp2' ? '🎯🎯' :
                    result.outcome === 'tp1' ? '🎯' :
                    result.outcome === 'expired' ? '⏰' : '📊';

      logger.info(
        `${emoji} ${signal.coin} ${signal.direction.toUpperCase()} | ` +
        `${result.outcome.toUpperCase()} | ` +
        `P&L: ${result.pnl_pct >= 0 ? '+' : ''}${result.pnl_pct.toFixed(2)}% | ` +
        `Max: +${result.max_profit_pct.toFixed(2)}% / ${result.max_drawdown_pct.toFixed(2)}% | ` +
        `${result.duration_hours.toFixed(1)}h`
      );
    }

    processed++;
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));

    // Progress update
    if (processed % 10 === 0) {
      logger.info(`Progress: ${processed}/${signals.length}`);
    }
  }

  // Summary
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('BACKTEST SUMMARY');
  logger.info('='.repeat(60));
  
  const stopped = results.filter(r => r.outcome === 'stopped').length;
  const tp1 = results.filter(r => r.outcome === 'tp1').length;
  const tp2 = results.filter(r => r.outcome === 'tp2').length;
  const tp3 = results.filter(r => r.outcome === 'tp3').length;
  const expired = results.filter(r => r.outcome === 'expired').length;
  const open = results.filter(r => r.outcome === 'open').length;
  
  const closed = results.filter(r => r.outcome !== 'open');
  const winners = closed.filter(r => r.pnl_pct > 0);
  const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
  const avgPnl = closed.length > 0 
    ? closed.reduce((sum, r) => sum + r.pnl_pct, 0) / closed.length 
    : 0;
  const totalPnl = closed.reduce((sum, r) => sum + r.pnl_pct, 0);

  logger.info(`Total signals: ${results.length}`);
  logger.info(`  🛑 Stopped: ${stopped}`);
  logger.info(`  🎯 TP1: ${tp1}`);
  logger.info(`  🎯🎯 TP2: ${tp2}`);
  logger.info(`  🎯🎯🎯 TP3: ${tp3}`);
  logger.info(`  ⏰ Expired: ${expired}`);
  logger.info(`  📊 Still Open: ${open}`);
  logger.info('');
  logger.info(`Win Rate: ${winRate.toFixed(1)}%`);
  logger.info(`Avg P&L: ${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(2)}%`);
  logger.info(`Total P&L: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%`);
  logger.info('');

  // By confidence level
  logger.info('BY CONFIDENCE:');
  const highConf = closed.filter(r => {
    const sig = signals.find(s => s.id === r.signal_id);
    return sig && sig.confidence >= 75;
  });
  const medConf = closed.filter(r => {
    const sig = signals.find(s => s.id === r.signal_id);
    return sig && sig.confidence >= 60 && sig.confidence < 75;
  });
  
  if (highConf.length > 0) {
    const highWinRate = (highConf.filter(r => r.pnl_pct > 0).length / highConf.length) * 100;
    const highAvgPnl = highConf.reduce((sum, r) => sum + r.pnl_pct, 0) / highConf.length;
    logger.info(`  High (75+): ${highConf.length} signals, ${highWinRate.toFixed(1)}% WR, ${highAvgPnl >= 0 ? '+' : ''}${highAvgPnl.toFixed(2)}% avg`);
  }
  
  if (medConf.length > 0) {
    const medWinRate = (medConf.filter(r => r.pnl_pct > 0).length / medConf.length) * 100;
    const medAvgPnl = medConf.reduce((sum, r) => sum + r.pnl_pct, 0) / medConf.length;
    logger.info(`  Medium (60-74): ${medConf.length} signals, ${medWinRate.toFixed(1)}% WR, ${medAvgPnl >= 0 ? '+' : ''}${medAvgPnl.toFixed(2)}% avg`);
  }

  logger.info('');
}

main().catch(console.error);