// Position Tracker V3
// Polls positions for quality traders and triggers signal generation

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import { generateSignals } from './signal-generator.js';

const logger = createLogger('position-tracker');

// ============================================
// Types
// ============================================

interface HyperliquidPosition {
  coin: string;
  szi: string;
  entryPx: string;
  positionValue: string;
  leverage: { type: string; value: number };
  unrealizedPnl: string;
  marginUsed: string;
  liquidationPx: string | null;
}

interface ClearinghouseState {
  assetPositions: Array<{
    position: HyperliquidPosition;
  }>;
}

// ============================================
// API Functions
// ============================================

async function fetchPositions(address: string): Promise<HyperliquidPosition[]> {
  try {
    const response = await fetch(config.hyperliquid.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clearinghouseState',
        user: address,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data: ClearinghouseState = await response.json();
    
    if (!data || !data.assetPositions) {
      return [];
    }

    // Filter to positions with non-zero size
    return data.assetPositions
      .map(ap => ap.position)
      .filter(p => parseFloat(p.szi) !== 0);
  } catch (error) {
    logger.error(`Failed to fetch positions for ${address}`, error);
    return [];
  }
}

// ============================================
// Position Processing
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
}

function processPositions(address: string, positions: HyperliquidPosition[]): TrackedPosition[] {
  return positions
    .filter(p => {
      const value = Math.abs(parseFloat(p.positionValue || '0'));
      return value >= config.positions.minPositionValue;
    })
    .map(p => {
      const size = parseFloat(p.szi);
      return {
        address,
        coin: p.coin,
        direction: size > 0 ? 'long' : 'short',
        size: Math.abs(size),
        entry_price: parseFloat(p.entryPx),
        value_usd: Math.abs(parseFloat(p.positionValue)),
        leverage: p.leverage?.value || 1,
        unrealized_pnl: parseFloat(p.unrealizedPnl || '0'),
        margin_used: parseFloat(p.marginUsed || '0'),
        liquidation_price: p.liquidationPx ? parseFloat(p.liquidationPx) : null,
      };
    }) as TrackedPosition[];
}

// ============================================
// Database Operations
// ============================================

async function savePositions(positions: TrackedPosition[]): Promise<void> {
  if (positions.length === 0) return;

  // Group by address for efficient upsert
  const byAddress = new Map<string, TrackedPosition[]>();
  for (const pos of positions) {
    const existing = byAddress.get(pos.address) || [];
    existing.push(pos);
    byAddress.set(pos.address, existing);
  }

  for (const [address, addressPositions] of byAddress) {
    // Delete old positions for this address
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
            ...p,
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
    // Get all tracked traders
    const { data: trackedTraders, error } = await db.client
      .from('trader_quality')
      .select('address')
      .eq('is_tracked', true)
      .in('quality_tier', ['elite', 'good']);

    if (error || !trackedTraders || trackedTraders.length === 0) {
      logger.debug('No tracked traders to poll');
      isPolling = false;
      return;
    }

    logger.info(`Polling ${trackedTraders.length} quality traders...`);

    const allPositions: TrackedPosition[] = [];

    // Fetch positions for each trader
    for (const trader of trackedTraders) {
      const positions = await fetchPositions(trader.address);
      const processed = processPositions(trader.address, positions);
      allPositions.push(...processed);

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, config.rateLimit.delayBetweenRequests));
    }

    // Save all positions
    await savePositions(allPositions);
    
    logger.info(`Updated ${allPositions.length} positions`);

    // Generate signals based on new positions
    await generateSignals();

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
  logger.info('Position tracker starting...');
  
  // Initial poll
  pollPositions();
  
  // Schedule regular polling
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
}> {
  const { data: positions } = await db.client
    .from('trader_positions')
    .select('coin, value_usd');

  if (!positions || positions.length === 0) {
    return { totalPositions: 0, uniqueCoins: 0, totalValue: 0 };
  }

  const uniqueCoins = new Set(positions.map(p => p.coin)).size;
  const totalValue = positions.reduce((sum, p) => sum + (p.value_usd || 0), 0);

  return {
    totalPositions: positions.length,
    uniqueCoins,
    totalValue,
  };
}

export async function getPositionsForCoin(coin: string): Promise<TrackedPosition[]> {
  const { data } = await db.client
    .from('trader_positions')
    .select('*')
    .eq('coin', coin);

  return data || [];
}