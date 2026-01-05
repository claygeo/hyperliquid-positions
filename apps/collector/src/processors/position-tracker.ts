// Position Tracker V6
// Fixed: opened_at now persists across restarts by reading from DB
// Enhanced with:
// - Position history tracking (entry timing detection)
// - Position age weighting (fresh positions > stale)
// - Change detection (open, increase, decrease, close, flip)
// - Urgent re-evaluation with drawdown metrics
// - Open order awareness

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import hyperliquid, { Position, OpenOrder } from '../utils/hyperliquid-api.js';
import { generateSignals } from './signal-generator.js';

const logger = createLogger('position-tracker-v6');

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
  conviction_pct: number;
  has_pending_entry: boolean;
  has_stop_order: boolean;
  has_tp_order: boolean;
  pending_order_price: number | null;
  // V5 additions
  opened_at: Date | null;
  position_age_hours: number;
  last_size_change_at: Date | null;
  peak_unrealized_pnl: number;
  trough_unrealized_pnl: number;
}

interface PositionChange {
  address: string;
  coin: string;
  event_type: 'open' | 'increase' | 'decrease' | 'close' | 'flip';
  direction: 'long' | 'short';
  prev_size: number;
  prev_entry_price: number;
  prev_value_usd: number;
  new_size: number;
  new_entry_price: number;
  new_value_usd: number;
  size_change: number;
  price_at_event: number;
  leverage: number;
  unrealized_pnl: number;
}

interface PreviousPositionState {
  address: string;
  coin: string;
  direction: string;
  size: number;
  entry_price: number;
  value_usd: number;
  opened_at: Date | null;
  peak_unrealized_pnl: number;
  trough_unrealized_pnl: number;
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

// In-memory cache of previous positions for change detection
const previousPositions = new Map<string, PreviousPositionState>();

// Track if we've loaded from DB this session
let hasLoadedFromDb = false;

// ============================================
// V6: Load Previous Positions from Database
// ============================================

async function loadPreviousPositionsFromDb(): Promise<void> {
  if (hasLoadedFromDb) return;
  
  try {
    const { data: dbPositions } = await db.client
      .from('trader_positions')
      .select('address, coin, direction, size, entry_price, value_usd, opened_at, peak_unrealized_pnl, trough_unrealized_pnl');
    
    if (dbPositions && dbPositions.length > 0) {
      for (const pos of dbPositions) {
        const key = `${pos.address}-${pos.coin}`;
        previousPositions.set(key, {
          address: pos.address,
          coin: pos.coin,
          direction: pos.direction,
          size: pos.size || 0,
          entry_price: pos.entry_price || 0,
          value_usd: pos.value_usd || 0,
          opened_at: pos.opened_at ? new Date(pos.opened_at) : null,
          peak_unrealized_pnl: pos.peak_unrealized_pnl || 0,
          trough_unrealized_pnl: pos.trough_unrealized_pnl || 0,
        });
      }
      logger.info(`Loaded ${dbPositions.length} previous positions from database`);
    }
    
    hasLoadedFromDb = true;
  } catch (error) {
    logger.error('Failed to load previous positions from DB', error);
    hasLoadedFromDb = true; // Don't retry on error
  }
}

// ============================================
// Position Change Detection
// ============================================

function detectPositionChange(
  address: string,
  current: TrackedPosition | null,
  currentPrice: number
): PositionChange | null {
  const key = `${address}-${current?.coin || 'unknown'}`;
  const prev = previousPositions.get(key);

  // No previous position
  if (!prev && current) {
    return {
      address,
      coin: current.coin,
      event_type: 'open',
      direction: current.direction,
      prev_size: 0,
      prev_entry_price: 0,
      prev_value_usd: 0,
      new_size: current.size,
      new_entry_price: current.entry_price,
      new_value_usd: current.value_usd,
      size_change: current.size,
      price_at_event: currentPrice,
      leverage: current.leverage,
      unrealized_pnl: current.unrealized_pnl,
    };
  }

  // Position closed
  if (prev && !current) {
    return {
      address,
      coin: prev.coin,
      event_type: 'close',
      direction: prev.direction as 'long' | 'short',
      prev_size: prev.size,
      prev_entry_price: prev.entry_price,
      prev_value_usd: prev.value_usd,
      new_size: 0,
      new_entry_price: 0,
      new_value_usd: 0,
      size_change: -prev.size,
      price_at_event: currentPrice,
      leverage: 1,
      unrealized_pnl: 0,
    };
  }

  // Both exist - check for changes
  if (prev && current) {
    // Direction flip (rare but important)
    if (prev.direction !== current.direction) {
      return {
        address,
        coin: current.coin,
        event_type: 'flip',
        direction: current.direction,
        prev_size: prev.size,
        prev_entry_price: prev.entry_price,
        prev_value_usd: prev.value_usd,
        new_size: current.size,
        new_entry_price: current.entry_price,
        new_value_usd: current.value_usd,
        size_change: current.size + prev.size, // Total change
        price_at_event: currentPrice,
        leverage: current.leverage,
        unrealized_pnl: current.unrealized_pnl,
      };
    }

    // Size increase
    if (current.size > prev.size * 1.05) { // 5% threshold to filter noise
      return {
        address,
        coin: current.coin,
        event_type: 'increase',
        direction: current.direction,
        prev_size: prev.size,
        prev_entry_price: prev.entry_price,
        prev_value_usd: prev.value_usd,
        new_size: current.size,
        new_entry_price: current.entry_price,
        new_value_usd: current.value_usd,
        size_change: current.size - prev.size,
        price_at_event: currentPrice,
        leverage: current.leverage,
        unrealized_pnl: current.unrealized_pnl,
      };
    }

    // Size decrease (partial close)
    if (current.size < prev.size * 0.95) {
      return {
        address,
        coin: current.coin,
        event_type: 'decrease',
        direction: current.direction,
        prev_size: prev.size,
        prev_entry_price: prev.entry_price,
        prev_value_usd: prev.value_usd,
        new_size: current.size,
        new_entry_price: current.entry_price,
        new_value_usd: current.value_usd,
        size_change: prev.size - current.size,
        price_at_event: currentPrice,
        leverage: current.leverage,
        unrealized_pnl: current.unrealized_pnl,
      };
    }
  }

  return null;
}

async function savePositionChange(change: PositionChange): Promise<void> {
  try {
    await db.client.from('position_history').insert({
      address: change.address,
      coin: change.coin,
      event_type: change.event_type,
      direction: change.direction,
      prev_size: change.prev_size,
      prev_entry_price: change.prev_entry_price,
      prev_value_usd: change.prev_value_usd,
      new_size: change.new_size,
      new_entry_price: change.new_entry_price,
      new_value_usd: change.new_value_usd,
      size_change: change.size_change,
      price_at_event: change.price_at_event,
      leverage: change.leverage,
      unrealized_pnl: change.unrealized_pnl,
      detected_at: new Date().toISOString(),
    });

    const emoji = {
      open: '🟢',
      increase: '⬆️',
      decrease: '⬇️',
      close: '🔴',
      flip: '🔄',
    }[change.event_type];

    logger.info(
      `${emoji} POSITION ${change.event_type.toUpperCase()}: ` +
      `${change.address.slice(0, 8)}... ${change.coin} ${change.direction.toUpperCase()} | ` +
      `Size: ${change.prev_size.toFixed(2)} → ${change.new_size.toFixed(2)} | ` +
      `$${change.new_value_usd.toFixed(0)}`
    );
  } catch (error) {
    // Table might not exist yet
    logger.debug('Could not save position history', error);
  }
}

function updatePreviousPositionCache(
  address: string,
  position: TrackedPosition | null
): void {
  const key = `${address}-${position?.coin || 'unknown'}`;
  
  if (position) {
    previousPositions.set(key, {
      address,
      coin: position.coin,
      direction: position.direction,
      size: position.size,
      entry_price: position.entry_price,
      value_usd: position.value_usd,
      opened_at: position.opened_at,
      peak_unrealized_pnl: position.peak_unrealized_pnl,
      trough_unrealized_pnl: position.trough_unrealized_pnl,
    });
  } else {
    previousPositions.delete(key);
  }
}

// ============================================
// Open Order Processing
// ============================================

async function processOpenOrders(
  address: string,
  orders: OpenOrder[]
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

  const byAddress = new Map<string, TrackedOpenOrder[]>();
  for (const order of orders) {
    const existing = byAddress.get(order.address) || [];
    existing.push(order);
    byAddress.set(order.address, existing);
  }

  for (const [address, addressOrders] of byAddress) {
    await db.client
      .from('trader_open_orders')
      .delete()
      .eq('address', address);

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
  const drawdownPct = accountValue > 0 
    ? (unrealizedPnl / accountValue) * 100 
    : 0;

  const triggers: UrgentReevalTrigger[] = [];

  // Use V5 config thresholds (less aggressive)
  const severeThreshold = config.urgentReeval?.severeDrawdownPct || -30;
  const eliteThreshold = config.urgentReeval?.eliteDrawdownPct || -20;

  if (drawdownPct < severeThreshold) {
    triggers.push({
      address,
      reason: `severe_drawdown_${Math.abs(drawdownPct).toFixed(1)}pct`,
      priority: 1,
      currentDrawdownPct: drawdownPct,
    });
  } else if (tier === 'elite' && drawdownPct < eliteThreshold) {
    triggers.push({
      address,
      reason: `elite_drawdown_${Math.abs(drawdownPct).toFixed(1)}pct`,
      priority: 2,
      currentDrawdownPct: drawdownPct,
    });
  }

  // Check for recent liquidations
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
  positions: Position[],
  orders: OpenOrder[],
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
      const unrealizedPnl = parseFloat(p.unrealizedPnl || '0');

      const convictionPct = accountValue > 0 
        ? Math.min(100, (positionValue / accountValue) * 100)
        : 0;

      const relatedOrders = orders.filter(o => o.coin === coin);
      const hasPendingEntry = relatedOrders.some(o => !o.reduceOnly);
      const hasStopOrder = relatedOrders.some(o => 
        o.reduceOnly && o.isTrigger && 
        ((size > 0 && o.side === 'A') || (size < 0 && o.side === 'B'))
      );
      const hasTpOrder = relatedOrders.some(o => 
        o.reduceOnly && !o.isTrigger
      );

      const pendingEntry = relatedOrders.find(o => !o.reduceOnly);
      const pendingOrderPrice = pendingEntry 
        ? parseFloat(pendingEntry.limitPx || pendingEntry.triggerPx || '0')
        : null;

      // V6: Get previous state from cache (which was loaded from DB on startup)
      const key = `${address}-${coin}`;
      const prev = previousPositions.get(key);
      
      // Determine opened_at - only set to now if this is truly a new position
      let openedAt = prev?.opened_at || null;
      const currentDirection = size > 0 ? 'long' : 'short';
      
      if (!prev) {
        // No previous record at all - new position
        openedAt = new Date();
      } else if (prev.direction !== currentDirection) {
        // Direction changed (flip) - treat as new position
        openedAt = new Date();
      }
      // Otherwise keep the existing opened_at from DB/cache

      // Calculate position age
      const positionAgeHours = openedAt 
        ? (Date.now() - openedAt.getTime()) / (1000 * 60 * 60)
        : 0;

      // Track peak/trough unrealized P&L
      const peakUnrealizedPnl = prev 
        ? Math.max(prev.peak_unrealized_pnl || unrealizedPnl, unrealizedPnl)
        : unrealizedPnl;
      const troughUnrealizedPnl = prev 
        ? Math.min(prev.trough_unrealized_pnl || unrealizedPnl, unrealizedPnl)
        : unrealizedPnl;

      return {
        address,
        coin,
        direction: currentDirection,
        size: Math.abs(size),
        entry_price: parseFloat(p.entryPx),
        value_usd: positionValue,
        leverage: p.leverage?.value || 1,
        unrealized_pnl: unrealizedPnl,
        margin_used: parseFloat(p.marginUsed || '0'),
        liquidation_price: p.liquidationPx ? parseFloat(p.liquidationPx) : null,
        conviction_pct: convictionPct,
        has_pending_entry: hasPendingEntry,
        has_stop_order: hasStopOrder,
        has_tp_order: hasTpOrder,
        pending_order_price: pendingOrderPrice,
        opened_at: openedAt,
        position_age_hours: positionAgeHours,
        last_size_change_at: new Date(), // Will be updated on actual changes
        peak_unrealized_pnl: peakUnrealizedPnl,
        trough_unrealized_pnl: troughUnrealizedPnl,
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
    await db.client
      .from('trader_positions')
      .delete()
      .eq('address', address);

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
            opened_at: p.opened_at?.toISOString(),
            position_age_hours: p.position_age_hours,
            last_size_change_at: p.last_size_change_at?.toISOString(),
            peak_unrealized_pnl: p.peak_unrealized_pnl,
            trough_unrealized_pnl: p.trough_unrealized_pnl,
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
    // V6: Load previous positions from DB on first poll
    await loadPreviousPositionsFromDb();

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

    const allPositions: TrackedPosition[] = [];
    const allOpenOrders: TrackedOpenOrder[] = [];
    const positionChanges: PositionChange[] = [];
    let urgentReevals = 0;

    // Get current prices once
    const allMids = await hyperliquid.getAllMids();

    for (const trader of trackedTraders) {
      const data = await hyperliquid.getFullPositionData(trader.address);
      
      if (!data) {
        await new Promise(resolve => setTimeout(resolve, config.rateLimit.delayBetweenRequests));
        continue;
      }

      const processed = processPositions(
        trader.address,
        data.positions,
        data.openOrders,
        data.accountValue
      );

      // Detect position changes for each position
      const currentCoins = new Set(processed.map(p => p.coin));
      
      // Check for changes in existing positions
      for (const position of processed) {
        const currentPrice = parseFloat(allMids[position.coin] || '0');
        const change = detectPositionChange(trader.address, position, currentPrice);
        
        if (change) {
          positionChanges.push(change);
          await savePositionChange(change);
        }
        
        // Update cache
        updatePreviousPositionCache(trader.address, position);
      }

      // Check for closed positions (positions that existed before but don't now)
      for (const [key, prev] of previousPositions) {
        if (key.startsWith(trader.address) && !currentCoins.has(prev.coin)) {
          const currentPrice = parseFloat(allMids[prev.coin] || '0');
          const change = detectPositionChange(trader.address, null, currentPrice);
          
          if (change) {
            positionChanges.push(change);
            await savePositionChange(change);
          }
          
          // Remove from cache
          previousPositions.delete(key);
        }
      }

      allPositions.push(...processed);

      const orders = await processOpenOrders(trader.address, data.openOrders);
      allOpenOrders.push(...orders);

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

      await new Promise(resolve => setTimeout(resolve, config.rateLimit.delayBetweenRequests));
    }

    await savePositions(allPositions);
    await saveOpenOrders(allOpenOrders);

    logger.info(
      `Updated ${allPositions.length} positions, ${allOpenOrders.length} open orders` +
      (positionChanges.length > 0 ? `, ${positionChanges.length} changes` : '') +
      (urgentReevals > 0 ? `, ${urgentReevals} urgent reevals` : '')
    );

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
      .limit(config.urgentReeval?.maxPerCycle || 5);

    if (!queue || queue.length === 0) return;

    logger.info(`Processing ${queue.length} urgent re-evaluations...`);

    for (const item of queue) {
      const { analyzeTrader, saveTraderAnalysis } = await import('./pnl-analyzer.js');
      
      const analysis = await analyzeTrader(item.address);
      
      if (analysis) {
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
// Position Age Utilities
// ============================================

export async function getFreshPositions(maxAgeHours: number = 4): Promise<TrackedPosition[]> {
  const { data } = await db.client
    .from('trader_positions')
    .select('*')
    .gte('opened_at', new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString())
    .order('opened_at', { ascending: false });

  return (data || []) as TrackedPosition[];
}

export async function getRecentPositionChanges(hours: number = 24): Promise<PositionChange[]> {
  const { data } = await db.client
    .from('position_history')
    .select('*')
    .gte('detected_at', new Date(Date.now() - hours * 60 * 60 * 1000).toISOString())
    .order('detected_at', { ascending: false });

  return (data || []) as PositionChange[];
}

export async function getPositionAgeStats(): Promise<{
  avgAgeHours: number;
  freshCount: number;
  staleCount: number;
}> {
  const { data: positions } = await db.client
    .from('trader_positions')
    .select('position_age_hours');

  if (!positions || positions.length === 0) {
    return { avgAgeHours: 0, freshCount: 0, staleCount: 0 };
  }

  const ages = positions.map(p => p.position_age_hours || 0);
  const avgAgeHours = ages.reduce((sum, a) => sum + a, 0) / ages.length;
  const freshCount = ages.filter(a => a < 4).length;
  const staleCount = ages.filter(a => a > 168).length; // 1 week

  return { avgAgeHours, freshCount, staleCount };
}

// ============================================
// Exports
// ============================================

export function startPositionTracker(): void {
  logger.info('Position tracker V6 starting...');
  
  pollPositions();
  
  pollInterval = setInterval(pollPositions, config.positions.pollIntervalMs);
  
  setInterval(processUrgentReevals, config.urgentReeval?.processIntervalMs || 2 * 60 * 1000);
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
  avgPositionAge: number;
}> {
  const { data: positions } = await db.client
    .from('trader_positions')
    .select('coin, value_usd, has_stop_order, position_age_hours');

  if (!positions || positions.length === 0) {
    return { 
      totalPositions: 0, 
      uniqueCoins: 0, 
      totalValue: 0,
      avgConviction: 0,
      withStopOrders: 0,
      avgPositionAge: 0,
    };
  }

  const uniqueCoins = new Set(positions.map(p => p.coin)).size;
  const totalValue = positions.reduce((sum, p) => sum + (p.value_usd || 0), 0);
  const withStopOrders = positions.filter(p => p.has_stop_order).length;
  const avgAge = positions.reduce((sum, p) => sum + (p.position_age_hours || 0), 0) / positions.length;

  return {
    totalPositions: positions.length,
    uniqueCoins,
    totalValue,
    avgConviction: 0,
    withStopOrders,
    avgPositionAge: avgAge,
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
  getFreshPositions,
  getRecentPositionChanges,
  getPositionAgeStats,
};