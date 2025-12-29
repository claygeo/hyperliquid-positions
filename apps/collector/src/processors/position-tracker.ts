// Position Tracker - Tracks positions of quality traders
// Runs continuously, polls every 60 seconds

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
// Position Updates
// ============================================

async function updateTraderPositions(trader: TrackedTrader): Promise<number> {
  const positions = await fetchPositions(trader.address);
  
  // Get current stored positions
  const existingResult = await db.client
    .from('trader_positions')
    .select('coin')
    .eq('address', trader.address);
  
  const existingCoins = new Set(
    (existingResult.data || []).map((p: { coin: string }) => p.coin)
  );
  
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
  
  // Remove closed positions
  for (const coin of existingCoins) {
    if (!currentCoins.has(coin)) {
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

export default { startPositionTracker, stopPositionTracker, getPositionStats };