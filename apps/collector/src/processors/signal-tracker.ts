// Signal Tracker V4
// Enhanced with:
// - Direct price tracking on quality_signals table
// - Stop/TP hit detection
// - Outcome tracking (stopped, tp1, tp2, tp3, closed, expired)
// - Max profit / max drawdown tracking
// - Duration tracking
// - Asset performance aggregation

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import hyperliquid from '../utils/hyperliquid-api.js';

const logger = createLogger('signal-tracker-v4');

// ============================================
// Types
// ============================================

interface ActiveSignal {
  id: number;
  coin: string;
  direction: 'long' | 'short';
  entry_price: number;
  suggested_entry: number;
  current_price: number | null;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  take_profit_3: number;
  stop_distance_pct: number;
  elite_count: number;
  good_count: number;
  confidence: number;
  created_at: string;
  max_pnl_pct: number;
  min_pnl_pct: number;
  peak_price: number | null;
  trough_price: number | null;
  hit_stop: boolean;
  hit_tp1: boolean;
  hit_tp2: boolean;
  hit_tp3: boolean;
}

interface SignalUpdate {
  current_price: number;
  current_pnl_pct: number;
  max_pnl_pct: number;
  min_pnl_pct: number;
  peak_price: number;
  trough_price: number;
  hit_stop: boolean;
  hit_tp1: boolean;
  hit_tp2: boolean;
  hit_tp3: boolean;
  outcome?: string;
  is_active?: boolean;
  closed_at?: string;
  final_pnl_pct?: number;
  duration_hours?: number;
  invalidated?: boolean;
  invalidation_reason?: string;
}

export interface PerformanceSummary {
  totalSignals: number;
  activeSignals: number;
  closedSignals: number;
  stoppedCount: number;
  tp1Count: number;
  tp2Count: number;
  tp3Count: number;
  expiredCount: number;
  winRate: number;
  avgPnlPct: number;
  totalPnlPct: number;
  avgDurationHours: number;
  avgMaxProfit: number;
  avgMaxDrawdown: number;
  bestSignal: { coin: string; direction: string; pnl: number } | null;
  worstSignal: { coin: string; direction: string; pnl: number } | null;
}

// ============================================
// Core Tracking Functions
// ============================================

/**
 * Calculate P&L percentage for a signal
 */
function calculatePnlPct(
  direction: 'long' | 'short',
  entryPrice: number,
  currentPrice: number
): number {
  if (direction === 'long') {
    return ((currentPrice - entryPrice) / entryPrice) * 100;
  } else {
    return ((entryPrice - currentPrice) / entryPrice) * 100;
  }
}

/**
 * Check if price has hit stop loss
 */
function checkStopHit(
  direction: 'long' | 'short',
  currentPrice: number,
  stopLoss: number
): boolean {
  if (direction === 'long') {
    return currentPrice <= stopLoss;
  } else {
    return currentPrice >= stopLoss;
  }
}

/**
 * Check if price has hit take profit level
 */
function checkTpHit(
  direction: 'long' | 'short',
  currentPrice: number,
  tpPrice: number
): boolean {
  if (direction === 'long') {
    return currentPrice >= tpPrice;
  } else {
    return currentPrice <= tpPrice;
  }
}

/**
 * Update all active signals with current prices and check for stops/targets
 */
export async function updateSignalPrices(): Promise<void> {
  try {
    // Get all active signals
    const { data: signals, error } = await db.client
      .from('quality_signals')
      .select('*')
      .eq('is_active', true);

    if (error || !signals || signals.length === 0) {
      return;
    }

    // Get current prices for all coins
    const prices = await hyperliquid.getAllMids();
    if (Object.keys(prices).length === 0) {
      logger.warn('No prices available');
      return;
    }

    let updatedCount = 0;
    let closedCount = 0;

    for (const signal of signals) {
      const currentPrice = parseFloat(prices[signal.coin] || '0');
      if (!currentPrice) continue;

      const entryPrice = signal.entry_price || signal.suggested_entry;
      const direction = signal.direction as 'long' | 'short';

      // Calculate current P&L
      const currentPnlPct = calculatePnlPct(direction, entryPrice, currentPrice);

      // Track peak and trough
      const peakPrice = signal.peak_price 
        ? (direction === 'long' 
            ? Math.max(signal.peak_price, currentPrice)
            : Math.min(signal.peak_price, currentPrice))
        : currentPrice;
      
      const troughPrice = signal.trough_price
        ? (direction === 'long'
            ? Math.min(signal.trough_price, currentPrice)
            : Math.max(signal.trough_price, currentPrice))
        : currentPrice;

      // Calculate max profit and max drawdown
      const maxPnlPct = Math.max(signal.max_pnl_pct || 0, currentPnlPct);
      const minPnlPct = Math.min(signal.min_pnl_pct || 0, currentPnlPct);

      // Check stops and targets
      const hitStop = signal.hit_stop || checkStopHit(direction, currentPrice, signal.stop_loss);
      const hitTp1 = signal.hit_tp1 || checkTpHit(direction, currentPrice, signal.take_profit_1);
      const hitTp2 = signal.hit_tp2 || checkTpHit(direction, currentPrice, signal.take_profit_2);
      const hitTp3 = signal.hit_tp3 || checkTpHit(direction, currentPrice, signal.take_profit_3);

      // Prepare update
      const update: SignalUpdate = {
        current_price: currentPrice,
        current_pnl_pct: currentPnlPct,
        max_pnl_pct: maxPnlPct,
        min_pnl_pct: minPnlPct,
        peak_price: peakPrice,
        trough_price: troughPrice,
        hit_stop: hitStop,
        hit_tp1: hitTp1,
        hit_tp2: hitTp2,
        hit_tp3: hitTp3,
      };

      // Check if signal should be closed
      const createdAt = new Date(signal.created_at).getTime();
      const durationHours = (Date.now() - createdAt) / (1000 * 60 * 60);
      
      let shouldClose = false;
      let outcome = 'open';
      let closeReason = '';

      // Check stop hit
      if (hitStop && !signal.hit_stop) {
        shouldClose = true;
        outcome = 'stopped';
        closeReason = 'stop_loss_hit';
        logger.warn(
          `🛑 STOP HIT: ${signal.coin} ${direction.toUpperCase()} | ` +
          `Entry: $${entryPrice.toFixed(4)} | Stop: $${signal.stop_loss.toFixed(4)} | ` +
          `Exit: $${currentPrice.toFixed(4)} | P&L: ${currentPnlPct.toFixed(2)}%`
        );
      }

      // Check TP3 hit (best outcome)
      if (hitTp3 && !signal.hit_tp3) {
        shouldClose = true;
        outcome = 'tp3';
        closeReason = 'take_profit_3_hit';
        logger.info(
          `🎯🎯🎯 TP3 HIT: ${signal.coin} ${direction.toUpperCase()} | ` +
          `Entry: $${entryPrice.toFixed(4)} | TP3: $${signal.take_profit_3.toFixed(4)} | ` +
          `P&L: ${currentPnlPct.toFixed(2)}%`
        );
      } else if (hitTp2 && !signal.hit_tp2 && !hitTp3) {
        // Log TP2 but don't close (let it run to TP3)
        logger.info(
          `🎯🎯 TP2 HIT: ${signal.coin} ${direction.toUpperCase()} | ` +
          `P&L: ${currentPnlPct.toFixed(2)}% | Running for TP3...`
        );
      } else if (hitTp1 && !signal.hit_tp1 && !hitTp2) {
        // Log TP1 but don't close
        logger.info(
          `🎯 TP1 HIT: ${signal.coin} ${direction.toUpperCase()} | ` +
          `P&L: ${currentPnlPct.toFixed(2)}% | Running for TP2...`
        );
      }

      // Check expiry
      if (durationHours >= config.signalTracking.maxSignalHours && !shouldClose) {
        shouldClose = true;
        outcome = 'expired';
        closeReason = 'max_duration_exceeded';
        logger.info(
          `⏰ EXPIRED: ${signal.coin} ${direction.toUpperCase()} | ` +
          `Duration: ${durationHours.toFixed(1)}h | P&L: ${currentPnlPct.toFixed(2)}%`
        );
      }

      // Check if underlying signal was invalidated
      if (signal.invalidated && !shouldClose) {
        shouldClose = true;
        outcome = 'closed';
        closeReason = signal.invalidation_reason || 'invalidated';
      }

      if (shouldClose) {
        update.outcome = outcome;
        update.is_active = false;
        update.closed_at = new Date().toISOString();
        update.final_pnl_pct = currentPnlPct;
        update.duration_hours = durationHours;
        update.invalidated = true;
        update.invalidation_reason = closeReason;

        closedCount++;

        // Update asset performance
        await updateAssetPerformance(signal.coin, signal.direction, currentPnlPct, durationHours, outcome);
      }

      // Save update
      await db.client
        .from('quality_signals')
        .update(update)
        .eq('id', signal.id);

      updatedCount++;
    }

    if (updatedCount > 0) {
      logger.debug(`Updated ${updatedCount} signals, closed ${closedCount}`);
    }

  } catch (error) {
    logger.error('updateSignalPrices failed', error);
  }
}

/**
 * Initialize entry_price for signals that don't have it
 */
export async function initializeEntryPrices(): Promise<void> {
  try {
    const { error } = await db.client
      .from('quality_signals')
      .update({ entry_price: db.client.rpc('suggested_entry') })
      .is('entry_price', null);

    // Fallback: update manually
    const { data: signals } = await db.client
      .from('quality_signals')
      .select('id, suggested_entry')
      .is('entry_price', null);

    if (signals && signals.length > 0) {
      for (const signal of signals) {
        await db.client
          .from('quality_signals')
          .update({ entry_price: signal.suggested_entry })
          .eq('id', signal.id);
      }
      logger.info(`Initialized entry_price for ${signals.length} signals`);
    }
  } catch (error) {
    logger.error('initializeEntryPrices failed', error);
  }
}

/**
 * Update asset performance stats when a signal closes
 */
async function updateAssetPerformance(
  coin: string,
  direction: string,
  pnlPct: number,
  durationHours: number,
  outcome: string
): Promise<void> {
  try {
    const { data: stats } = await db.client
      .from('asset_performance')
      .select('*')
      .eq('coin', coin)
      .single();

    const isWin = pnlPct > 0;

    if (stats) {
      const totalSignals = (stats.total_signals || 0) + 1;
      const winningSignals = (stats.winning_signals || 0) + (isWin ? 1 : 0);
      const losingSignals = (stats.losing_signals || 0) + (isWin ? 0 : 1);
      const totalPnlPct = (stats.total_pnl_pct || 0) + pnlPct;
      const avgPnlPct = totalPnlPct / totalSignals;
      const winRate = winningSignals / totalSignals;
      const avgDuration = ((stats.avg_duration_hours || 0) * (totalSignals - 1) + durationHours) / totalSignals;

      await db.client
        .from('asset_performance')
        .update({
          total_signals: totalSignals,
          winning_signals: winningSignals,
          losing_signals: losingSignals,
          avg_pnl_pct: avgPnlPct,
          total_pnl_pct: totalPnlPct,
          win_rate: winRate,
          avg_duration_hours: avgDuration,
          best_signal_pnl_pct: Math.max(stats.best_signal_pnl_pct || -999, pnlPct),
          worst_signal_pnl_pct: Math.min(stats.worst_signal_pnl_pct || 999, pnlPct),
          last_signal_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('coin', coin);
    } else {
      await db.client
        .from('asset_performance')
        .insert({
          coin,
          total_signals: 1,
          winning_signals: isWin ? 1 : 0,
          losing_signals: isWin ? 0 : 1,
          avg_pnl_pct: pnlPct,
          total_pnl_pct: pnlPct,
          win_rate: isWin ? 1 : 0,
          avg_duration_hours: durationHours,
          best_signal_pnl_pct: pnlPct,
          worst_signal_pnl_pct: pnlPct,
          last_signal_at: new Date().toISOString(),
        });
    }
  } catch (error) {
    logger.error(`Failed to update asset performance for ${coin}`, error);
  }
}

// ============================================
// Performance Summary Functions
// ============================================

export async function getPerformanceSummary(): Promise<PerformanceSummary> {
  try {
    const { data: signals } = await db.client
      .from('quality_signals')
      .select('*');

    if (!signals || signals.length === 0) {
      return {
        totalSignals: 0,
        activeSignals: 0,
        closedSignals: 0,
        stoppedCount: 0,
        tp1Count: 0,
        tp2Count: 0,
        tp3Count: 0,
        expiredCount: 0,
        winRate: 0,
        avgPnlPct: 0,
        totalPnlPct: 0,
        avgDurationHours: 0,
        avgMaxProfit: 0,
        avgMaxDrawdown: 0,
        bestSignal: null,
        worstSignal: null,
      };
    }

    const activeSignals = signals.filter(s => s.is_active);
    const closedSignals = signals.filter(s => !s.is_active && s.final_pnl_pct !== null);
    
    const stoppedCount = closedSignals.filter(s => s.outcome === 'stopped').length;
    const tp1Count = closedSignals.filter(s => s.outcome === 'tp1').length;
    const tp2Count = closedSignals.filter(s => s.outcome === 'tp2').length;
    const tp3Count = closedSignals.filter(s => s.outcome === 'tp3').length;
    const expiredCount = closedSignals.filter(s => s.outcome === 'expired').length;

    const winners = closedSignals.filter(s => (s.final_pnl_pct || 0) > 0);
    const totalPnl = closedSignals.reduce((sum, s) => sum + (s.final_pnl_pct || 0), 0);
    const totalDuration = closedSignals.reduce((sum, s) => sum + (s.duration_hours || 0), 0);
    const totalMaxProfit = closedSignals.reduce((sum, s) => sum + (s.max_pnl_pct || 0), 0);
    const totalMaxDrawdown = closedSignals.reduce((sum, s) => sum + (s.min_pnl_pct || 0), 0);

    const sorted = [...closedSignals].sort((a, b) => (b.final_pnl_pct || 0) - (a.final_pnl_pct || 0));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    return {
      totalSignals: signals.length,
      activeSignals: activeSignals.length,
      closedSignals: closedSignals.length,
      stoppedCount,
      tp1Count,
      tp2Count,
      tp3Count,
      expiredCount,
      winRate: closedSignals.length > 0 ? winners.length / closedSignals.length : 0,
      avgPnlPct: closedSignals.length > 0 ? totalPnl / closedSignals.length : 0,
      totalPnlPct: totalPnl,
      avgDurationHours: closedSignals.length > 0 ? totalDuration / closedSignals.length : 0,
      avgMaxProfit: closedSignals.length > 0 ? totalMaxProfit / closedSignals.length : 0,
      avgMaxDrawdown: closedSignals.length > 0 ? totalMaxDrawdown / closedSignals.length : 0,
      bestSignal: best ? { coin: best.coin, direction: best.direction, pnl: best.final_pnl_pct || 0 } : null,
      worstSignal: worst ? { coin: worst.coin, direction: worst.direction, pnl: worst.final_pnl_pct || 0 } : null,
    };
  } catch (error) {
    logger.error('getPerformanceSummary failed', error);
    return {
      totalSignals: 0,
      activeSignals: 0,
      closedSignals: 0,
      stoppedCount: 0,
      tp1Count: 0,
      tp2Count: 0,
      tp3Count: 0,
      expiredCount: 0,
      winRate: 0,
      avgPnlPct: 0,
      totalPnlPct: 0,
      avgDurationHours: 0,
      avgMaxProfit: 0,
      avgMaxDrawdown: 0,
      bestSignal: null,
      worstSignal: null,
    };
  }
}

export async function getActiveSignalsWithPerformance(): Promise<unknown[]> {
  const { data } = await db.client
    .from('quality_signals')
    .select('*')
    .eq('is_active', true)
    .order('confidence', { ascending: false });

  return data || [];
}

export async function getClosedSignals(limit: number = 50): Promise<unknown[]> {
  const { data } = await db.client
    .from('quality_signals')
    .select('*')
    .eq('is_active', false)
    .not('final_pnl_pct', 'is', null)
    .order('closed_at', { ascending: false })
    .limit(limit);

  return data || [];
}

export async function getAssetPerformance(): Promise<unknown[]> {
  const { data } = await db.client
    .from('asset_performance')
    .select('*')
    .gt('total_signals', 0)
    .order('total_pnl_pct', { ascending: false });

  return data || [];
}

// ============================================
// Tracker Loop
// ============================================

let trackerInterval: NodeJS.Timeout | null = null;
let priceInterval: NodeJS.Timeout | null = null;

export function startSignalTracker(): void {
  logger.info('Starting signal tracker V4...');

  // Initialize entry prices
  initializeEntryPrices();

  // Initial update
  updateSignalPrices();

  // Update prices every 30 seconds
  priceInterval = setInterval(updateSignalPrices, 30 * 1000);

  logger.info('Signal tracker running - updating prices every 30s');
}

export function stopSignalTracker(): void {
  if (trackerInterval) {
    clearInterval(trackerInterval);
    trackerInterval = null;
  }
  if (priceInterval) {
    clearInterval(priceInterval);
    priceInterval = null;
  }
  logger.info('Signal tracker stopped');
}

export default {
  startSignalTracker,
  stopSignalTracker,
  updateSignalPrices,
  getPerformanceSummary,
  getActiveSignalsWithPerformance,
  getClosedSignals,
  getAssetPerformance,
};