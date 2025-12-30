// Signal Tracker V3
// Tracks every signal from open to close
// Records actual P&L, max drawdown, max profit
// Feeds back into system for adaptive improvements

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';

const logger = createLogger('signal-tracker');

// ============================================
// Types
// ============================================

interface SignalOutcome {
  id?: number;
  signal_id: number;
  coin: string;
  direction: string;
  
  // Entry
  entry_price: number;
  entry_time: string;
  entry_traders: number;
  entry_elite_count: number;
  entry_good_count: number;
  entry_confidence: number;
  
  // Exit
  exit_price?: number;
  exit_time?: string;
  exit_reason?: string;
  
  // Performance
  current_price: number;
  current_pnl_pct: number;
  max_profit_pct: number;
  max_drawdown_pct: number;
  
  // Final results
  final_pnl_pct?: number;
  duration_hours?: number;
  hit_stop: boolean;
  hit_target_1: boolean;
  hit_target_2: boolean;
  hit_target_3: boolean;
  
  // Levels
  stop_loss_price: number;
  take_profit_1: number;
  take_profit_2: number;
  take_profit_3: number;
  
  // Status
  is_active: boolean;
}

interface ActiveSignal {
  id: number;
  coin: string;
  direction: string;
  suggested_entry: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  take_profit_3: number;
  elite_count: number;
  good_count: number;
  total_traders: number;
  confidence: number;
  created_at: string;
}

// ============================================
// Price Fetching
// ============================================

async function getAllPrices(): Promise<Map<string, number>> {
  try {
    const response = await fetch(config.hyperliquid.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
    });
    
    const data = await response.json();
    const prices = new Map<string, number>();
    
    for (const [coin, price] of Object.entries(data)) {
      if (typeof price === 'string') {
        prices.set(coin, parseFloat(price));
      }
    }
    
    return prices;
  } catch (error) {
    logger.error('Failed to fetch prices', error);
    return new Map();
  }
}

// ============================================
// Core Tracking Functions
// ============================================

/**
 * Create a new signal outcome when a signal is generated
 */
export async function createSignalOutcome(signal: ActiveSignal): Promise<void> {
  try {
    // Check if outcome already exists for this signal
    const { data: existing } = await db.client
      .from('signal_outcomes')
      .select('id')
      .eq('signal_id', signal.id)
      .single();
    
    if (existing) {
      logger.debug(`Outcome already exists for signal ${signal.id}`);
      return;
    }
    
    const outcome: Omit<SignalOutcome, 'id'> = {
      signal_id: signal.id,
      coin: signal.coin,
      direction: signal.direction,
      
      entry_price: signal.suggested_entry,
      entry_time: signal.created_at,
      entry_traders: signal.total_traders,
      entry_elite_count: signal.elite_count,
      entry_good_count: signal.good_count,
      entry_confidence: signal.confidence,
      
      current_price: signal.suggested_entry,
      current_pnl_pct: 0,
      max_profit_pct: 0,
      max_drawdown_pct: 0,
      
      hit_stop: false,
      hit_target_1: false,
      hit_target_2: false,
      hit_target_3: false,
      
      stop_loss_price: signal.stop_loss,
      take_profit_1: signal.take_profit_1,
      take_profit_2: signal.take_profit_2,
      take_profit_3: signal.take_profit_3,
      
      is_active: true,
    };
    
    const { error } = await db.client
      .from('signal_outcomes')
      .insert(outcome);
    
    if (error) {
      logger.error(`Failed to create outcome for signal ${signal.id}`, error);
    } else {
      logger.info(`Created outcome tracking for ${signal.coin} ${signal.direction}`);
    }
  } catch (error) {
    logger.error('createSignalOutcome failed', error);
  }
}

/**
 * Update all active signal outcomes with current prices
 */
export async function updateSignalOutcomes(): Promise<void> {
  try {
    // Get all active outcomes
    const { data: outcomes, error } = await db.client
      .from('signal_outcomes')
      .select('*')
      .eq('is_active', true);
    
    if (error || !outcomes || outcomes.length === 0) {
      return;
    }
    
    // Get current prices
    const prices = await getAllPrices();
    if (prices.size === 0) {
      logger.warn('No prices available for update');
      return;
    }
    
    for (const outcome of outcomes) {
      const currentPrice = prices.get(outcome.coin);
      if (!currentPrice) continue;
      
      // Calculate current P&L
      let currentPnlPct: number;
      if (outcome.direction === 'long') {
        currentPnlPct = ((currentPrice - outcome.entry_price) / outcome.entry_price) * 100;
      } else {
        currentPnlPct = ((outcome.entry_price - currentPrice) / outcome.entry_price) * 100;
      }
      
      // Update max profit and max drawdown
      const maxProfitPct = Math.max(outcome.max_profit_pct || 0, currentPnlPct);
      const maxDrawdownPct = Math.min(outcome.max_drawdown_pct || 0, currentPnlPct);
      
      // Check if stop or targets hit
      let hitStop = outcome.hit_stop;
      let hitTarget1 = outcome.hit_target_1;
      let hitTarget2 = outcome.hit_target_2;
      let hitTarget3 = outcome.hit_target_3;
      
      if (outcome.direction === 'long') {
        hitStop = hitStop || currentPrice <= outcome.stop_loss_price;
        hitTarget1 = hitTarget1 || currentPrice >= outcome.take_profit_1;
        hitTarget2 = hitTarget2 || currentPrice >= outcome.take_profit_2;
        hitTarget3 = hitTarget3 || currentPrice >= outcome.take_profit_3;
      } else {
        hitStop = hitStop || currentPrice >= outcome.stop_loss_price;
        hitTarget1 = hitTarget1 || currentPrice <= outcome.take_profit_1;
        hitTarget2 = hitTarget2 || currentPrice <= outcome.take_profit_2;
        hitTarget3 = hitTarget3 || currentPrice <= outcome.take_profit_3;
      }
      
      // Check if signal should be closed
      let shouldClose = false;
      let exitReason = '';
      
      // Close if stop hit
      if (hitStop && config.signalTracking.closeOnStopHit) {
        shouldClose = true;
        exitReason = 'stop_hit';
      }
      
      // Check if signal is still active in quality_signals
      const { data: signal } = await db.client
        .from('quality_signals')
        .select('is_active')
        .eq('id', outcome.signal_id)
        .single();
      
      if (signal && !signal.is_active && config.signalTracking.closeOnTraderExit) {
        shouldClose = true;
        exitReason = exitReason || 'traders_exited';
      }
      
      // Check max duration
      const entryTime = new Date(outcome.entry_time).getTime();
      const durationHours = (Date.now() - entryTime) / (1000 * 60 * 60);
      
      if (durationHours >= config.signalTracking.maxSignalHours) {
        shouldClose = true;
        exitReason = exitReason || 'expired';
      }
      
      // Prepare update
      const update: Partial<SignalOutcome> = {
        current_price: currentPrice,
        current_pnl_pct: currentPnlPct,
        max_profit_pct: maxProfitPct,
        max_drawdown_pct: maxDrawdownPct,
        hit_stop: hitStop,
        hit_target_1: hitTarget1,
        hit_target_2: hitTarget2,
        hit_target_3: hitTarget3,
      };
      
      if (shouldClose) {
        update.is_active = false;
        update.exit_price = currentPrice;
        update.exit_time = new Date().toISOString();
        update.exit_reason = exitReason;
        update.final_pnl_pct = currentPnlPct;
        update.duration_hours = durationHours;
        
        // Log the closure
        const emoji = currentPnlPct >= 0 ? '✅' : '❌';
        logger.info(
          `${emoji} Signal CLOSED: ${outcome.coin} ${outcome.direction.toUpperCase()} | ` +
          `${currentPnlPct >= 0 ? '+' : ''}${currentPnlPct.toFixed(2)}% | ` +
          `Max: +${maxProfitPct.toFixed(2)}% | ` +
          `DD: ${maxDrawdownPct.toFixed(2)}% | ` +
          `Duration: ${durationHours.toFixed(1)}h | ` +
          `Reason: ${exitReason}`
        );
        
        // Update asset performance stats
        await updateAssetPerformance(outcome.coin, currentPnlPct, durationHours);
      }
      
      // Save update
      await db.client
        .from('signal_outcomes')
        .update(update)
        .eq('id', outcome.id);
    }
  } catch (error) {
    logger.error('updateSignalOutcomes failed', error);
  }
}

/**
 * Update asset performance stats when a signal closes
 */
async function updateAssetPerformance(
  coin: string,
  pnlPct: number,
  durationHours: number
): Promise<void> {
  try {
    // Get current stats
    const { data: stats } = await db.client
      .from('asset_performance')
      .select('*')
      .eq('coin', coin)
      .single();
    
    const isWin = pnlPct > 0;
    
    if (stats) {
      // Update existing
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
          best_signal_pnl_pct: Math.max(stats.best_signal_pnl_pct || 0, pnlPct),
          worst_signal_pnl_pct: Math.min(stats.worst_signal_pnl_pct || 0, pnlPct),
          last_signal_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('coin', coin);
    } else {
      // Insert new
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

/**
 * Sync signal outcomes with active signals
 * Creates outcomes for new signals
 */
export async function syncSignalOutcomes(): Promise<void> {
  try {
    // Get all active signals
    const { data: signals, error } = await db.client
      .from('quality_signals')
      .select('id, coin, direction, suggested_entry, stop_loss, take_profit_1, take_profit_2, take_profit_3, elite_count, good_count, total_traders, confidence, created_at')
      .eq('is_active', true);
    
    if (error || !signals) {
      return;
    }
    
    // Create outcomes for any signals without them
    for (const signal of signals) {
      await createSignalOutcome(signal);
    }
  } catch (error) {
    logger.error('syncSignalOutcomes failed', error);
  }
}

// ============================================
// Performance Summary Functions
// ============================================

export interface PerformanceSummary {
  totalSignals: number;
  winningSignals: number;
  losingSignals: number;
  winRate: number;
  avgPnlPct: number;
  totalPnlPct: number;
  avgDurationHours: number;
  avgMaxProfit: number;
  avgMaxDrawdown: number;
  bestSignal: { coin: string; pnl: number } | null;
  worstSignal: { coin: string; pnl: number } | null;
}

export async function getPerformanceSummary(): Promise<PerformanceSummary> {
  const { data: outcomes } = await db.client
    .from('signal_outcomes')
    .select('*')
    .eq('is_active', false)
    .not('final_pnl_pct', 'is', null);
  
  if (!outcomes || outcomes.length === 0) {
    return {
      totalSignals: 0,
      winningSignals: 0,
      losingSignals: 0,
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
  
  const winners = outcomes.filter(o => (o.final_pnl_pct || 0) > 0);
  const totalPnl = outcomes.reduce((sum, o) => sum + (o.final_pnl_pct || 0), 0);
  const totalDuration = outcomes.reduce((sum, o) => sum + (o.duration_hours || 0), 0);
  const totalMaxProfit = outcomes.reduce((sum, o) => sum + (o.max_profit_pct || 0), 0);
  const totalMaxDrawdown = outcomes.reduce((sum, o) => sum + (o.max_drawdown_pct || 0), 0);
  
  const sorted = [...outcomes].sort((a, b) => (b.final_pnl_pct || 0) - (a.final_pnl_pct || 0));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  
  return {
    totalSignals: outcomes.length,
    winningSignals: winners.length,
    losingSignals: outcomes.length - winners.length,
    winRate: winners.length / outcomes.length,
    avgPnlPct: totalPnl / outcomes.length,
    totalPnlPct: totalPnl,
    avgDurationHours: totalDuration / outcomes.length,
    avgMaxProfit: totalMaxProfit / outcomes.length,
    avgMaxDrawdown: totalMaxDrawdown / outcomes.length,
    bestSignal: best ? { coin: best.coin, pnl: best.final_pnl_pct || 0 } : null,
    worstSignal: worst ? { coin: worst.coin, pnl: worst.final_pnl_pct || 0 } : null,
  };
}

export async function getAssetPerformance(): Promise<any[]> {
  const { data } = await db.client
    .from('asset_performance')
    .select('*')
    .gt('total_signals', 0)
    .order('avg_pnl_pct', { ascending: false });
  
  return data || [];
}

// ============================================
// Tracker Loop
// ============================================

let trackerInterval: NodeJS.Timeout | null = null;

export function startSignalTracker(): void {
  logger.info('Starting signal performance tracker...');
  
  // Initial sync
  syncSignalOutcomes();
  updateSignalOutcomes();
  
  // Run every minute
  trackerInterval = setInterval(async () => {
    await syncSignalOutcomes();
    await updateSignalOutcomes();
  }, config.signalTracking.updateIntervalMs);
}

export function stopSignalTracker(): void {
  if (trackerInterval) {
    clearInterval(trackerInterval);
    trackerInterval = null;
    logger.info('Signal tracker stopped');
  }
}