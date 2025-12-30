// Position Tracker V4
// Enhanced with:
// - Open order awareness (see entries before they fill)
// - Urgent re-evaluation triggers (rapid demotion on blowups)
// - Position conviction scoring
// - Real-time fill integration

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import hyperliquid from '../utils/hyperliquid-api.js';
import { generateSignals } from './signal-generator.js';

const logger = createLogger('position-tracker-v4');

// ============================================
// Types
// ============================================

interface TrackedPosition {
  address: string;
  coin: string;
  direction: 'long' | 'short';
  size: number;
  entry_price: number;
  value_usd: number;
  leverage: number;
  unrealized_pnl: number;
  margin_used: number;
  liquidation_price: number | null;
  // V4 additions
  conviction_pct: number; // position_value / account_value
  has_pending_entry: boolean;
  has_stop_order: boolean;
  has_tp_order: boolean;
  pending_order_price: number | null;
}

interface TrackedOpenOrder {
  address: string;
  coin: string;
  side: 'buy' | 'sell';
  order_type: string;
  size: number;
  limit_price: number | null;
  trigger_price: number | null;
  reduce_only: boolean;
  order_id: string;
}

interface UrgentReevalTrigger {
  address: string;
  reason: string;
  priority: number;
  currentDrawdownPct: number;
}

// ============================================
// Open Order Processing
// ============================================

async function processOpenOrders(
  address: string,
  orders: hyperliquid.OpenOrder[]
): Promise<TrackedOpenOrder[]> {
  const tracked: TrackedOpenOrder[] = [];

  for (const order of orders) {
    tracked.push({
      address,
      coin: order.coin,
      side: order.side === 'B' ? 'buy' : 'sell',
      order_type: order.isTrigger ? 'trigger' : 'limit',
      size: parseFloat(order.sz),
      limit_price: order.limitPx ? parseFloat(order.limitPx) : null,
      trigger_price: order.triggerPx ? parseFloat(order.triggerPx) : null,
      reduce_only: order.reduceOnly,
      order_id: String(order.oid),
    });
  }

  return tracked;
}

async function saveOpenOrders(orders: TrackedOpenOrder[]): Promise<void> {
  if (orders.length === 0) return;

  // Group by address
  const byAddress = new Map<string, TrackedOpenOrder[]>();
  for (const order of orders) {
    const existing = byAddress.get(order.address) || [];
    existing.push(order);
    byAddress.set(order.address, existing);
  }

  for (const [address, addressOrders] of byAddress) {
    // Delete old orders for this address
    await db.client
      .from('trader_open_orders')
      .delete()
      .eq('address', address);

    // Insert new orders
    if (addressOrders.length > 0) {
      await db.client.from('trader_open_orders').insert(
        addressOrders.map(o => ({
          address: o.address,
          coin: o.coin,
          side: o.side,
          order_type: o.order_type,
          size: o.size,
          limit_price: o.limit_price,
          trigger_price: o.trigger_price,
          reduce_only: o.reduce_only,
          order_id: o.order_id,
          updated_at: new Date().toISOString(),
        }))
      );
    }
  }
}

// ============================================
// Urgent Re-evaluation Logic
// ============================================

async function checkForUrgentReeval(
  address: string,
  accountValue: number,
  unrealizedPnl: number,
  tier: string
): Promise<UrgentReevalTrigger | null> {
  // Calculate drawdown percentage
  const drawdownPct = accountValue > 0 
    ? (unrealizedPnl / accountValue) * 100 
    : 0;

  const triggers: UrgentReevalTrigger[] = [];

  // Trigger 1: Severe drawdown (>15% unrealized loss)
  if (drawdownPct < -15) {
    triggers.push({
      address,
      reason: `severe_drawdown_${Math.abs(drawdownPct).toFixed(1)}pct`,
      priority: 1,
      currentDrawdownPct: drawdownPct,
    });
  }
  // Trigger 2: Moderate drawdown for elite traders (>10%)
  else if (tier === 'elite' && drawdownPct < -10) {
    triggers.push({
      address,
      reason: `elite_drawdown_${Math.abs(drawdownPct).toFixed(1)}pct`,
      priority: 2,
      currentDrawdownPct: drawdownPct,
    });
  }
  // Trigger 3: Check for recent liquidation
  const { wasLiquidated } = await hyperliquid.checkRecentLiquidations(address, 24);
  if (wasLiquidated) {
    triggers.push({
      address,
      reason: 'recent_liquidation',
      priority: 1,
      currentDrawdownPct: drawdownPct,
    });
  }

  if (triggers.length === 0) return null;

  // Return highest priority trigger
  triggers.sort((a, b) => a.priority - b.priority);
  return triggers[0];
}

async function queueUrgentReeval(trigger: UrgentReevalTrigger): Promise<void> {
  try {
    await db.client.from('trader_reeval_queue').upsert({
      address: trigger.address,
      reason: trigger.reason,
      priority: trigger.priority,
      current_drawdown_pct: trigger.currentDrawdownPct,
      triggered_at: new Date().toISOString(),
      processed_at: null,
    }, { onConflict: 'address' });

    logger.warn(
      `🚨 URGENT REEVAL: ${trigger.address.slice(0, 10)}... | ` +
      `Reason: ${trigger.reason} | Priority: ${trigger.priority}`
    );
  } catch (error) {
    logger.error('Failed to queue urgent reeval', error);
  }
}

// ============================================
// Position Processing
// ============================================

function processPositions(
  address: string,
  positions: hyperliquid.Position[],
  orders: hyperliquid.OpenOrder[],
  accountValue: number
): TrackedPosition[] {
  return positions
    .filter(p => {
      const value = Math.abs(parseFloat(p.positionValue || '0'));
      return value >= config.positions.minPositionValue;
    })
    .map(p => {
      const size = parseFloat(p.szi);
      const coin = p.coin;
      const positionValue = Math.abs(parseFloat(p.positionValue));

      // Calculate conviction (position size relative to account)
      const convictionPct = accountValue > 0 
        ? (positionValue / accountValue) * 100 
        : 0;

      // Check for related orders
      const relatedOrders = orders.filter(o => o.coin === coin);
      const hasPendingEntry = relatedOrders.some(o => !o.reduceOnly);
      const hasStopOrder = relatedOrders.some(o => 
        o.reduceOnly && o.isTrigger && 
        ((size > 0 && o.side === 'A') || (size < 0 && o.side === 'B'))
      );
      const hasTpOrder = relatedOrders.some(o => 
        o.reduceOnly && !o.isTrigger
      );

      // Get pending order price if exists
      const pendingEntry = relatedOrders.find(o => !o.reduceOnly);
      const pendingOrderPrice = pendingEntry 
        ? parseFloat(pendingEntry.limitPx || pendingEntry.triggerPx || '0')
        : null;

      return {
        address,
        coin,
        direction: size > 0 ? 'long' : 'short',
        size: Math.abs(size),
        entry_price: parseFloat(p.entryPx),
        value_usd: positionValue,
        leverage: p.leverage?.value || 1,
        unrealized_pnl: parseFloat(p.unrealizedPnl || '0'),
        margin_used: parseFloat(p.marginUsed || '0'),
        liquidation_price: p.liquidationPx ? parseFloat(p.liquidationPx) : null,
        conviction_pct: convictionPct,
        has_pending_entry: hasPendingEntry,
        has_stop_order: hasStopOrder,
        has_tp_order: hasTpOrder,
        pending_order_price: pendingOrderPrice,
      } as TrackedPosition;
    });
}

// ============================================
// Database Operations
// ============================================

async function savePositions(positions: TrackedPosition[]): Promise<void> {
  if (positions.length === 0) return;

  const byAddress = new Map<string, TrackedPosition[]>();
  for (const pos of positions) {
    const existing = byAddress.get(pos.address) || [];
    existing.push(pos);
    byAddress.set(pos.address, existing);
  }

  for (const [address, addressPositions] of byAddress) {
    // Delete old positions
    await db.client
      .from('trader_positions')
      .delete()
      .eq('address', address);

    // Insert new positions
    if (addressPositions.length > 0) {
      const { error } = await db.client
        .from('trader_positions')
        .insert(
          addressPositions.map(p => ({
            address: p.address,
            coin: p.coin,
            direction: p.direction,
            size: p.size,
            entry_price: p.entry_price,
            value_usd: p.value_usd,
            leverage: p.leverage,
            unrealized_pnl: p.unrealized_pnl,
            margin_used: p.margin_used,
            liquidation_price: p.liquidation_price,
            has_pending_entry: p.has_pending_entry,
            has_stop_order: p.has_stop_order,
            has_tp_order: p.has_tp_order,
            pending_order_price: p.pending_order_price,
            updated_at: new Date().toISOString(),
          }))
        );

      if (error) {
        logger.error(`Failed to save positions for ${address}`, error);
      }
    }
  }
}

// ============================================
// Main Polling Loop
// ============================================

let pollInterval: NodeJS.Timeout | null = null;
let isPolling = false;

async function pollPositions(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  try {
    // Get all tracked traders with their tier
    const { data: trackedTraders, error } = await db.client
      .from('trader_quality')
      .select('address, quality_tier, account_value')
      .eq('is_tracked', true)
      .in('quality_tier', ['elite', 'good']);

    if (error || !trackedTraders || trackedTraders.length === 0) {
      logger.debug('No tracked traders to poll');
      isPolling = false;
      return;
    }

    logger.info(`Polling ${trackedTraders.length} quality traders...`);

    const allPositions: TrackedPosition[] = [];
    const allOpenOrders: TrackedOpenOrder[] = [];
    let urgentReevals = 0;

    for (const trader of trackedTraders) {
      // Get full position data including open orders
      const data = await hyperliquid.getFullPositionData(trader.address);
      
      if (!data) {
        await new Promise(resolve => setTimeout(resolve, config.rateLimit.delayBetweenRequests));
        continue;
      }

      // Process positions with conviction scoring
      const processed = processPositions(
        trader.address,
        data.positions,
        data.openOrders,
        data.accountValue
      );
      allPositions.push(...processed);

      // Process open orders
      const orders = await processOpenOrders(trader.address, data.openOrders);
      allOpenOrders.push(...orders);

      // Check for urgent re-evaluation
      const totalUnrealizedPnl = data.positions.reduce(
        (sum, p) => sum + parseFloat(p.unrealizedPnl || '0'),
        0
      );

      const urgentTrigger = await checkForUrgentReeval(
        trader.address,
        data.accountValue,
        totalUnrealizedPnl,
        trader.quality_tier
      );

      if (urgentTrigger) {
        await queueUrgentReeval(urgentTrigger);
        urgentReevals++;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, config.rateLimit.delayBetweenRequests));
    }

    // Save all data
    await savePositions(allPositions);
    await saveOpenOrders(allOpenOrders);

    logger.info(
      `Updated ${allPositions.length} positions, ${allOpenOrders.length} open orders` +
      (urgentReevals > 0 ? `, ${urgentReevals} urgent reevals` : '')
    );

    // Generate signals based on new positions
    await generateSignals();

  } catch (error) {
    logger.error('Position polling failed', error);
  } finally {
    isPolling = false;
  }
}

// ============================================
// Urgent Re-eval Processing
// ============================================

async function processUrgentReevals(): Promise<void> {
  try {
    const { data: queue } = await db.client
      .from('trader_reeval_queue')
      .select('*')
      .is('processed_at', null)
      .order('priority', { ascending: true })
      .limit(5);

    if (!queue || queue.length === 0) return;

    logger.info(`Processing ${queue.length} urgent re-evaluations...`);

    for (const item of queue) {
      // Import dynamically to avoid circular dependency
      const { analyzeTrader, saveTraderAnalysis } = await import('./pnl-analyzer.js');
      
      const analysis = await analyzeTrader(item.address);
      
      if (analysis) {
        // Check if should be demoted
        if (analysis.quality_tier === 'weak') {
          logger.warn(
            `⬇️ DEMOTED: ${item.address.slice(0, 10)}... | ` +
            `Reason: ${item.reason} | ` +
            `New tier: ${analysis.quality_tier}`
          );

          await db.client
            .from('trader_quality')
            .update({ is_tracked: false })
            .eq('address', item.address);
        }

        await saveTraderAnalysis(analysis);
      }

      // Mark as processed
      await db.client
        .from('trader_reeval_queue')
        .update({ processed_at: new Date().toISOString() })
        .eq('address', item.address);

      await new Promise(resolve => setTimeout(resolve, 200));
    }
  } catch (error) {
    logger.error('Failed to process urgent reevals', error);
  }
}

// ============================================
// Exports
// ============================================

export function startPositionTracker(): void {
  logger.info('Position tracker V4 starting...');
  
  // Initial poll
  pollPositions();
  
  // Regular polling
  pollInterval = setInterval(pollPositions, config.positions.pollIntervalMs);
  
  // Process urgent reevals every 2 minutes
  setInterval(processUrgentReevals, 2 * 60 * 1000);
}

export function stopPositionTracker(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    logger.info('Position tracker stopped');
  }
}

export async function getPositionStats(): Promise<{
  totalPositions: number;
  uniqueCoins: number;
  totalValue: number;
  avgConviction: number;
  withStopOrders: number;
}> {
  const { data: positions } = await db.client
    .from('trader_positions')
    .select('coin, value_usd, has_stop_order');

  if (!positions || positions.length === 0) {
    return { 
      totalPositions: 0, 
      uniqueCoins: 0, 
      totalValue: 0,
      avgConviction: 0,
      withStopOrders: 0,
    };
  }

  const uniqueCoins = new Set(positions.map(p => p.coin)).size;
  const totalValue = positions.reduce((sum, p) => sum + (p.value_usd || 0), 0);
  const withStopOrders = positions.filter(p => p.has_stop_order).length;

  return {
    totalPositions: positions.length,
    uniqueCoins,
    totalValue,
    avgConviction: 0, // Would need account values to calculate
    withStopOrders,
  };
}

export async function getPositionsForCoin(coin: string): Promise<TrackedPosition[]> {
  const { data } = await db.client
    .from('trader_positions')
    .select('*')
    .eq('coin', coin);

  return (data || []) as TrackedPosition[];
}

export async function getPendingEntriesForCoin(coin: string): Promise<TrackedOpenOrder[]> {
  const { data } = await db.client
    .from('trader_open_orders')
    .select('*')
    .eq('coin', coin)
    .eq('reduce_only', false);

  return (data || []) as TrackedOpenOrder[];
}

export async function getUrgentReevalQueue(): Promise<unknown[]> {
  const { data } = await db.client
    .from('trader_reeval_queue')
    .select('*')
    .is('processed_at', null)
    .order('priority', { ascending: true });

  return data || [];
}

export default {
  startPositionTracker,
  stopPositionTracker,
  getPositionStats,
  getPositionsForCoin,
  getPendingEntriesForCoin,
  getUrgentReevalQueue,
};