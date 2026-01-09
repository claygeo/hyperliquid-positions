// Position Tracker V7.6
// 
// V7.6 CHANGES (Fix discovered positions on existing wallets):
// - Query fill history for ANY new position, not just new wallets
// - If position > 1 hour old, use actual timestamp from fill history
// - Fixes: unblacklisted coins getting wrong timestamps
//
// V7.5 CHANGES (Accurate Position Open Times):
// - NEW: Track "seenWallets" to distinguish newly added wallets vs. already tracked
// - NEW: For newly added wallets, query fill history to get ACTUAL opened_at timestamp
// - FIX: Don't emit fake "open" events for existing positions on newly added wallets
// - KEPT: All V7.4 functionality (proper close detection, etc.)
//
// V7.4 CHANGES (Fix Both Open AND Close Events):
// - REVERT: Save positions FIRST, then notify (V7.3 broke opens)
// - FIX: savePositions now properly deletes ALL positions for polled addresses
//   - Previously, traders who closed ALL positions were never deleted from DB
//   - Now we track which addresses we polled and ensure full cleanup
// - This fixes BOTH:
//   1. Open events: New positions are in DB when signal generator queries
//   2. Close events: Closed positions are deleted before signal generator queries

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import hyperliquid, { Position, OpenOrder, findPositionOpenTime } from '../utils/hyperliquid-api.js';

const logger = createLogger('position-tracker-v7.6');

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
  conviction_pct: number;
  has_pending_entry: boolean;
  has_stop_order: boolean;
  has_tp_order: boolean;
  pending_order_price: number | null;
  opened_at: Date;
  position_age_hours: number;
  last_size_change_at: Date;
  peak_unrealized_pnl: number;
  trough_unrealized_pnl: number;
}

export interface PositionChange {
  id?: number;
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
  detected_at: Date;
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

// In-memory cache of previous positions for change detection
const previousPositions = new Map<string, PreviousPositionState>();

// Track if we've loaded from DB this session
let hasLoadedFromDb = false;

// V7.5: Track which wallets we've polled before (to detect newly added wallets)
const seenWallets = new Set<string>();

// Callback for position changes (signal generator will subscribe)
type PositionChangeCallback = (changes: PositionChange[]) => Promise<void>;
let onPositionChanges: PositionChangeCallback | null = null;

// ============================================
// Subscribe to position changes
// ============================================

export function subscribeToPositionChanges(callback: PositionChangeCallback): void {
  onPositionChanges = callback;
  logger.info('Signal generator subscribed to position changes');
}

// ============================================
// Load Previous Positions from Database
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
        
        // V7.5: Mark wallets with existing positions as "seen"
        seenWallets.add(pos.address);
      }
      logger.info(`Loaded ${dbPositions.length} previous positions from database`);
      logger.info(`Marked ${seenWallets.size} wallets as previously seen`);
    }
    
    hasLoadedFromDb = true;
  } catch (error) {
    logger.error('Failed to load previous positions from DB', error);
    hasLoadedFromDb = true;
  }
}

// ============================================
// Position Change Detection
// ============================================

function detectPositionChange(
  address: string,
  current: TrackedPosition | null,
  prev: PreviousPositionState | null,
  currentPrice: number
): PositionChange | null {
  const now = new Date();

  // No previous position, current exists = OPEN
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
      detected_at: now,
    };
  }

  // Previous exists, current doesn't = CLOSE
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
      detected_at: now,
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
        size_change: current.size + prev.size,
        price_at_event: currentPrice,
        leverage: current.leverage,
        unrealized_pnl: current.unrealized_pnl,
        detected_at: now,
      };
    }

    // Size increase (5% threshold to filter noise)
    if (current.size > prev.size * 1.05) {
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
        detected_at: now,
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
        detected_at: now,
      };
    }
  }

  return null;
}

async function savePositionChange(change: PositionChange): Promise<number | null> {
  try {
    const { data, error } = await db.client
      .from('position_history')
      .insert({
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
        detected_at: change.detected_at.toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      logger.error('Failed to save position change', error);
      return null;
    }

    const emoji = {
      open: '[OPEN]',
      increase: '[ADD]',
      decrease: '[REDUCE]',
      close: '[CLOSE]',
      flip: '[FLIP]',
    }[change.event_type];

    logger.info(
      `${emoji} POSITION ${change.event_type.toUpperCase()}: ` +
      `${change.address.slice(0, 8)}... ${change.coin} ${change.direction.toUpperCase()} | ` +
      `Size: ${change.prev_size.toFixed(2)} -> ${change.new_size.toFixed(2)} | ` +
      `$${change.new_value_usd.toFixed(0)}`
    );

    return data?.id || null;
  } catch (error) {
    logger.error('Could not save position history', error);
    return null;
  }
}

function updatePreviousPositionCache(
  address: string,
  coin: string,
  position: TrackedPosition | null
): void {
  const key = `${address}-${coin}`;
  
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
// Position Processing
// ============================================

async function processPositions(
  address: string,
  positions: Position[],
  orders: OpenOrder[],
  accountValue: number,
  isNewWallet: boolean  // V7.5: Pass this flag
): Promise<TrackedPosition[]> {
  const results: TrackedPosition[] = [];
  const now = new Date();
  
  for (const p of positions) {
    const value = Math.abs(parseFloat(p.positionValue || '0'));
    if (value < config.positions.minPositionValue) continue;
    
    const size = parseFloat(p.szi);
    const coin = p.coin;
    const positionValue = Math.abs(parseFloat(p.positionValue));
    const unrealizedPnl = parseFloat(p.unrealizedPnl || '0');
    const currentDirection: 'long' | 'short' = size > 0 ? 'long' : 'short';

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

    const key = `${address}-${coin}`;
    const prev = previousPositions.get(key);
    
    let openedAt: Date;
    
    if (prev && prev.direction === currentDirection && prev.opened_at) {
      // We already know when this position was opened
      openedAt = prev.opened_at;
    } else if (isNewWallet) {
      // V7.5: NEW WALLET - Query fill history to get actual open time
      logger.debug(`[NEW WALLET] Querying fill history for ${address.slice(0, 8)}... ${coin} ${currentDirection}`);
      
      const fillData = await findPositionOpenTime(address, coin, currentDirection, 30);
      
      if (fillData) {
        openedAt = fillData.openedAt;
        logger.info(
          `[DISCOVERED] ${address.slice(0, 8)}... ${coin} ${currentDirection.toUpperCase()} | ` +
          `Actual open: ${openedAt.toISOString().slice(0, 16)} | ` +
          `Entry: $${fillData.entryPrice.toFixed(2)}`
        );
      } else {
        // Couldn't find fill history - mark as old so it doesn't generate signals
        openedAt = new Date(now.getTime() - (48 * 60 * 60 * 1000)); // 48 hours ago
        logger.warn(
          `[DISCOVERED] ${address.slice(0, 8)}... ${coin} ${currentDirection.toUpperCase()} | ` +
          `No fill history found, marking as stale`
        );
      }
    } else {
      // V7.6: Existing wallet, new position - query fill history to check if genuinely new
      const fillData = await findPositionOpenTime(address, coin, currentDirection, 30);
      
      if (fillData) {
        const fillAgeHours = (now.getTime() - fillData.openedAt.getTime()) / (1000 * 60 * 60);
        
        if (fillAgeHours < 1) {
          // Position opened within last hour - genuinely new, use now for accuracy
          openedAt = now;
        } else {
          // Position is older - we just discovered it (e.g., unblacklisted coin)
          openedAt = fillData.openedAt;
          logger.info(
            `[DISCOVERED-EXISTING] ${address.slice(0, 8)}... ${coin} ${currentDirection.toUpperCase()} | ` +
            `Actual open: ${openedAt.toISOString().slice(0, 16)} | ` +
            `Entry: $${fillData.entryPrice.toFixed(2)}`
          );
        }
      } else {
        // Couldn't find fill history - assume genuinely new
        openedAt = now;
      }
    }

    const positionAgeHours = (now.getTime() - openedAt.getTime()) / (1000 * 60 * 60);

    const peakUnrealizedPnl = prev 
      ? Math.max(prev.peak_unrealized_pnl || unrealizedPnl, unrealizedPnl)
      : unrealizedPnl;
    const troughUnrealizedPnl = prev 
      ? Math.min(prev.trough_unrealized_pnl || unrealizedPnl, unrealizedPnl)
      : unrealizedPnl;

    results.push({
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
      last_size_change_at: now,
      peak_unrealized_pnl: peakUnrealizedPnl,
      trough_unrealized_pnl: troughUnrealizedPnl,
    });
  }
  
  return results;
}

// ============================================
// Database Operations
// ============================================

// V7.4 FIX: Accept polledAddresses to ensure we delete positions for traders who closed everything
async function savePositions(positions: TrackedPosition[], polledAddresses: Set<string>): Promise<void> {
  const byAddress = new Map<string, TrackedPosition[]>();
  
  // Group positions by address
  for (const pos of positions) {
    const existing = byAddress.get(pos.address) || [];
    existing.push(pos);
    byAddress.set(pos.address, existing);
  }

  // V7.4 FIX: Process ALL polled addresses, not just those with positions
  // This ensures we delete positions for traders who closed everything
  for (const address of polledAddresses) {
    // Delete all existing positions for this address
    await db.client
      .from('trader_positions')
      .delete()
      .eq('address', address);

    // Insert current positions (if any)
    const addressPositions = byAddress.get(address) || [];
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
            opened_at: p.opened_at.toISOString(),
            position_age_hours: p.position_age_hours,
            last_size_change_at: p.last_size_change_at.toISOString(),
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
    
    // V7.4: Track which addresses we successfully polled
    const polledAddresses = new Set<string>();
    
    // V7.5: Track newly added wallets this poll cycle
    const newWalletsThisCycle: string[] = [];

    const allMids = await hyperliquid.getAllMids();

    for (const trader of trackedTraders) {
      const data = await hyperliquid.getFullPositionData(trader.address);
      
      if (!data) {
        await new Promise(resolve => setTimeout(resolve, config.rateLimit.delayBetweenRequests));
        continue;
      }

      // V7.4: Track this address as successfully polled
      polledAddresses.add(trader.address);
      
      // V7.5: Check if this is a newly added wallet
      const isNewWallet = !seenWallets.has(trader.address);
      if (isNewWallet) {
        newWalletsThisCycle.push(trader.address);
      }

      const processed = await processPositions(
        trader.address,
        data.positions,
        data.openOrders,
        data.accountValue,
        isNewWallet  // V7.5: Pass the flag
      );

      const currentCoins = new Set(processed.map(p => p.coin));
      
      // V7.5: Only detect changes for EXISTING wallets (not newly added)
      if (!isNewWallet) {
        // Detect changes for current positions
        for (const position of processed) {
          const key = `${trader.address}-${position.coin}`;
          const prev = previousPositions.get(key);
          const currentPrice = parseFloat(allMids[position.coin] || '0');
          
          const change = detectPositionChange(trader.address, position, prev || null, currentPrice);
          
          if (change) {
            const eventId = await savePositionChange(change);
            if (eventId) {
              change.id = eventId;
            }
            positionChanges.push(change);
          }
          
          // Update cache AFTER detecting changes
          updatePreviousPositionCache(trader.address, position.coin, position);
        }

        // Detect closed positions (existed in cache but not in current)
        for (const [key, prev] of previousPositions) {
          if (!key.startsWith(trader.address)) continue;
          
          const coin = prev.coin;
          if (!currentCoins.has(coin)) {
            const currentPrice = parseFloat(allMids[coin] || '0');
            const change = detectPositionChange(trader.address, null, prev, currentPrice);
            
            if (change) {
              const eventId = await savePositionChange(change);
              if (eventId) {
                change.id = eventId;
              }
              positionChanges.push(change);
            }
            
            // Remove from cache AFTER detecting changes
            previousPositions.delete(key);
          }
        }
      } else {
        // V7.5: NEW WALLET - Just populate the cache, don't emit events
        for (const position of processed) {
          updatePreviousPositionCache(trader.address, position.coin, position);
        }
        
        if (processed.length > 0) {
          logger.info(
            `[NEW WALLET] ${trader.address.slice(0, 8)}... has ${processed.length} existing positions ` +
            `(not emitting open events)`
          );
        }
      }

      allPositions.push(...processed);

      const orders = await processOpenOrders(trader.address, data.openOrders);
      allOpenOrders.push(...orders);

      await new Promise(resolve => setTimeout(resolve, config.rateLimit.delayBetweenRequests));
    }

    // V7.5: Mark all newly polled wallets as "seen" AFTER processing
    for (const address of newWalletsThisCycle) {
      seenWallets.add(address);
    }

    // V7.4: Save positions FIRST (so new positions are queryable)
    // Pass polledAddresses to ensure we delete positions for traders who closed everything
    await savePositions(allPositions, polledAddresses);
    await saveOpenOrders(allOpenOrders);

    // THEN notify signal generator (DB is now up-to-date for both opens and closes)
    if (positionChanges.length > 0 && onPositionChanges) {
      logger.debug(`Notifying signal generator of ${positionChanges.length} changes (DB already updated)`);
      await onPositionChanges(positionChanges);
    }

    const logMessage = `Updated ${allPositions.length} positions for ${polledAddresses.size} traders, ${allOpenOrders.length} orders`;
    const changeMessage = positionChanges.length > 0 ? `, ${positionChanges.length} changes detected` : '';
    const newWalletMessage = newWalletsThisCycle.length > 0 ? `, ${newWalletsThisCycle.length} new wallets initialized` : '';
    
    logger.info(logMessage + changeMessage + newWalletMessage);

  } catch (error) {
    logger.error('Position polling failed', error);
  } finally {
    isPolling = false;
  }
}

// ============================================
// Exports
// ============================================

export function startPositionTracker(): void {
  logger.info('Position tracker V7.6 starting...');
  logger.info('  - Accurate opened_at from fill history for new wallets');
  logger.info('  - Accurate opened_at for new positions on existing wallets');
  logger.info('  - No false open events for existing positions');
  
  pollPositions();
  
  pollInterval = setInterval(pollPositions, config.positions.pollIntervalMs);
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

// V7.5: Export for testing/debugging
export function getSeenWallets(): Set<string> {
  return new Set(seenWallets);
}

export function clearSeenWallets(): void {
  seenWallets.clear();
  logger.info('Cleared seen wallets cache');
}

export default {
  startPositionTracker,
  stopPositionTracker,
  subscribeToPositionChanges,
  getPositionStats,
  getPositionsForCoin,
  getFreshPositions,
  getRecentPositionChanges,
  getSeenWallets,
  clearSeenWallets,
};