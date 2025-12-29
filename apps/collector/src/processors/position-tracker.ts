// Position Tracker - Tracks positions of quality traders
// Now includes history tracking for opens/closes

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import { generateSignals } from './signal-generator.js';

const logger = createLogger('position-tracker');

const HYPERLIQUID_API = config.hyperliquid.api;

// ============================================
// Types
// ============================================

interface Position {
  coin: string;
  szi: string;
  entryPx: string;
  leverage: { value: string };
  positionValue: string;
  unrealizedPnl: string;
  marginUsed: string;
  liquidationPx: string | null;
}

interface ClearinghouseResponse {
  assetPositions: Array<{ position: Position }>;
}

interface TrackedTrader {
  address: string;
  quality_tier: string;
  pnl_7d: number;
  win_rate: number;
}

interface StoredPosition {
  coin: string;
  direction: string;
  entry_price: number;
  value_usd: number;
  size: number;
  leverage: number;
  updated_at: string;
}

// ============================================
// API
// ============================================

async function fetchPositions(address: string): Promise<Position[]> {
  try {
    const response = await fetch(HYPERLIQUID_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clearinghouseState',
        user: address,
      }),
    });
    
    if (!response.ok) return [];
    
    const data = await response.json() as ClearinghouseResponse;
    
    const positions: Position[] = [];
    if (data.assetPositions) {
      for (const ap of data.assetPositions) {
        if (ap.position && parseFloat(ap.position.szi) !== 0) {
          positions.push(ap.position);
        }
      }
    }
    
    return positions;
  } catch (error) {
    return [];
  }
}

// ============================================
// History Logging
// ============================================

async function logPositionOpened(
  trader: TrackedTrader,
  coin: string,
  direction: string,
  entryPrice: number,
  valueUsd: number,
  size: number,
  leverage: number
): Promise<void> {
  try {
    await db.client
      .from('signal_position_history')
      .insert({
        coin,
        direction,
        address: trader.address,
        event_type: 'opened',
        entry_price: entryPrice,
        position_value: valueUsd,
        size,
        leverage,
        quality_tier: trader.quality_tier,
        pnl_7d: trader.pnl_7d,
        win_rate: trader.win_rate,
      });
  } catch (error) {
    // Silently fail - history is nice to have but not critical
  }
}

async function logPositionClosed(
  trader: TrackedTrader,
  coin: string,
  direction: string,
  entryPrice: number,
  exitPrice: number,
  valueUsd: number,
  size: number,
  leverage: number,
  openedAt: string
): Promise<void> {
  try {
    // Calculate hold duration
    const openTime = new Date(openedAt).getTime();
    const closeTime = Date.now();
    const holdDurationHours = (closeTime - openTime) / (1000 * 60 * 60);
    
    // Estimate realized PnL
    let pnlRealized = 0;
    if (direction === 'long') {
      pnlRealized = (exitPrice - entryPrice) / entryPrice * valueUsd;
    } else {
      pnlRealized = (entryPrice - exitPrice) / entryPrice * valueUsd;
    }
    
    await db.client
      .from('signal_position_history')
      .insert({
        coin,
        direction,
        address: trader.address,
        event_type: 'closed',
        entry_price: entryPrice,
        exit_price: exitPrice,
        position_value: valueUsd,
        size,
        leverage,
        quality_tier: trader.quality_tier,
        pnl_7d: trader.pnl_7d,
        win_rate: trader.win_rate,
        pnl_realized: pnlRealized,
        hold_duration_hours: holdDurationHours,
      });
  } catch (error) {
    // Silently fail
  }
}

// ============================================
// Position Updates
// ============================================

async function updateTraderPositions(trader: TrackedTrader): Promise<number> {
  const positions = await fetchPositions(trader.address);
  
  // Get current stored positions with full details
  const existingResult = await db.client
    .from('trader_positions')
    .select('coin, direction, entry_price, value_usd, size, leverage, updated_at')
    .eq('address', trader.address);
  
  const existingPositions = new Map<string, StoredPosition>();
  for (const p of (existingResult.data || []) as StoredPosition[]) {
    existingPositions.set(p.coin, p);
  }
  
  const currentCoins = new Set<string>();
  let updatedCount = 0;
  
  // Update/insert positions
  for (const pos of positions) {
    const coin = pos.coin;
    const size = parseFloat(pos.szi);
    const direction = size > 0 ? 'long' : 'short';
    const valueUsd = parseFloat(pos.positionValue || '0');
    const entryPrice = parseFloat(pos.entryPx || '0');
    const leverage = parseFloat(pos.leverage?.value || '1');
    const unrealizedPnl = parseFloat(pos.unrealizedPnl || '0');
    const marginUsed = parseFloat(pos.marginUsed || '0');
    const liquidationPrice = pos.liquidationPx ? parseFloat(pos.liquidationPx) : null;
    
    // Only track major assets with significant value
    if (!config.positions.majorAssets.includes(coin)) continue;
    if (valueUsd < config.positions.minPositionValue) continue;
    
    currentCoins.add(coin);
    
    // Check if this is a NEW position or direction change
    const existing = existingPositions.get(coin);
    const isNewPosition = !existing;
    const isDirectionChange = existing && existing.direction !== direction;
    
    if (isNewPosition || isDirectionChange) {
      // Log the new position opened
      await logPositionOpened(
        trader,
        coin,
        direction,
        entryPrice,
        valueUsd,
        Math.abs(size),
        leverage
      );
      
      // If direction changed, also log the old one as closed
      if (isDirectionChange && existing) {
        // Get current price for exit (approximation - use entry of new position)
        await logPositionClosed(
          trader,
          coin,
          existing.direction,
          existing.entry_price,
          entryPrice, // Current price as exit
          existing.value_usd,
          existing.size,
          existing.leverage,
          existing.updated_at
        );
      }
    }
    
    await db.client
      .from('trader_positions')
      .upsert({
        address: trader.address,
        coin,
        direction,
        size: Math.abs(size),
        entry_price: entryPrice,
        value_usd: valueUsd,
        leverage,
        unrealized_pnl: unrealizedPnl,
        margin_used: marginUsed,
        liquidation_price: liquidationPrice,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'address,coin' });
    
    updatedCount++;
  }
  
  // Remove closed positions and log them
  for (const [coin, existing] of existingPositions) {
    if (!currentCoins.has(coin)) {
      // Position was closed - need to get current price for exit
      // Fetch current price from positions (if available) or use entry as approximation
      let exitPrice = existing.entry_price;
      
      // Try to get current price from another position or API
      // For now, use a simple approximation
      
      await logPositionClosed(
        trader,
        coin,
        existing.direction,
        existing.entry_price,
        exitPrice, // Best approximation
        existing.value_usd,
        existing.size,
        existing.leverage,
        existing.updated_at
      );
      
      await db.client
        .from('trader_positions')
        .delete()
        .eq('address', trader.address)
        .eq('coin', coin);
    }
  }
  
  return updatedCount;
}

// ============================================
// Polling Loop
// ============================================

async function pollAllTrackedTraders(): Promise<void> {
  // Get all tracked traders (elite + good)
  const result = await db.client
    .from('trader_quality')
    .select('address, quality_tier, pnl_7d, win_rate')
    .eq('is_tracked', true)
    .in('quality_tier', ['elite', 'good']);
  
  if (result.error || !result.data || result.data.length === 0) {
    logger.info('No tracked traders found');
    return;
  }
  
  const traders = result.data as TrackedTrader[];
  logger.info(`Polling ${traders.length} quality traders...`);
  
  let totalPositions = 0;
  
  // Process in batches to avoid rate limits
  const batchSize = config.analysis.batchSize;
  for (let i = 0; i < traders.length; i += batchSize) {
    const batch = traders.slice(i, i + batchSize);
    
    const results = await Promise.all(
      batch.map(trader => updateTraderPositions(trader))
    );
    
    totalPositions += results.reduce((a, b) => a + b, 0);
    
    // Small delay between batches
    if (i + batchSize < traders.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  logger.info(`Updated ${totalPositions} positions`);
  
  // Generate signals after position update
  await generateSignals();
}

// ============================================
// Public API
// ============================================

let pollInterval: NodeJS.Timeout | null = null;

export function startPositionTracker(): void {
  logger.info('Starting position tracker...');
  logger.info(`Tracking: ${config.positions.majorAssets.join(', ')}`);
  logger.info(`Min position: $${config.positions.minPositionValue}`);
  logger.info(`Poll interval: ${config.positions.pollIntervalMs / 1000}s`);
  
  // Initial poll after short delay
  setTimeout(pollAllTrackedTraders, 5000);
  
  // Start interval
  pollInterval = setInterval(pollAllTrackedTraders, config.positions.pollIntervalMs);
}

export function stopPositionTracker(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  logger.info('Position tracker stopped');
}

export async function getPositionStats(): Promise<{ totalPositions: number; uniqueCoins: number }> {
  const result = await db.client
    .from('trader_positions')
    .select('coin');
  
  const positions = (result.data || []) as { coin: string }[];
  const uniqueCoins = new Set(positions.map(p => p.coin));
  
  return {
    totalPositions: positions.length,
    uniqueCoins: uniqueCoins.size,
  };
}

// Get position history for a specific signal (coin + direction)
export async function getSignalHistory(
  coin: string,
  direction: string,
  hoursBack: number = 24
): Promise<{ opened: any[]; closed: any[] }> {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  
  const result = await db.client
    .from('signal_position_history')
    .select('*')
    .eq('coin', coin)
    .eq('direction', direction)
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  
  const history = result.data || [];
  
  return {
    opened: history.filter((h: any) => h.event_type === 'opened'),
    closed: history.filter((h: any) => h.event_type === 'closed'),
  };
}

export default { startPositionTracker, stopPositionTracker, getPositionStats, getSignalHistory };