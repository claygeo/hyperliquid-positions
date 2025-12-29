// Quality Position Tracker - Tracks positions of ELITE and GOOD traders only

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { generateSignals } from './signal-generator.js';

const logger = createLogger('position-tracker');

const HYPERLIQUID_API = 'https://api.hyperliquid.xyz/info';
const POLL_INTERVAL = 60000; // 60 seconds
const BATCH_SIZE = 10;
const BATCH_DELAY = 500;

// Major assets we care about
const MAJOR_ASSETS = ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'DOGE', 'SUI', 'AVAX', 'LINK', 'BNB'];
const MIN_POSITION_VALUE = 5000; // $5k minimum

interface Position {
  coin: string;
  szi: string;
  entryPx: string;
  leverage: { value: string };
  positionValue: string;
  unrealizedPnl: string;
  returnOnEquity: string;
}

interface ClearinghouseResponse {
  assetPositions: Array<{ position: Position }>;
}

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

async function updateTraderPositions(
  address: string, 
  tier: string,
  pnl_7d: number,
  win_rate: number
): Promise<void> {
  const positions = await fetchPositions(address);
  
  // Get current stored positions for this trader
  const existingResult = await db.client
    .from('trader_positions')
    .select('coin')
    .eq('address', address.toLowerCase());
  
  const existingCoins = new Set(
    existingResult.data?.map((p: { coin: string }) => p.coin) || []
  );
  
  const currentCoins = new Set<string>();
  
  // Update/insert current positions
  for (const pos of positions) {
    const coin = pos.coin;
    const size = parseFloat(pos.szi);
    const direction = size > 0 ? 'long' : 'short';
    const valueUsd = parseFloat(pos.positionValue || '0');
    const entryPrice = parseFloat(pos.entryPx || '0');
    const leverage = parseFloat(pos.leverage?.value || '1');
    const unrealizedPnl = parseFloat(pos.unrealizedPnl || '0');
    const returnOnEquity = parseFloat(pos.returnOnEquity || '0');
    
    // Only track major assets with significant value
    if (!MAJOR_ASSETS.includes(coin)) continue;
    if (valueUsd < MIN_POSITION_VALUE) continue;
    
    currentCoins.add(coin);
    
    await db.client
      .from('trader_positions')
      .upsert({
        address: address.toLowerCase(),
        coin,
        direction,
        size: Math.abs(size),
        entry_price: entryPrice,
        value_usd: valueUsd,
        leverage,
        unrealized_pnl: unrealizedPnl,
        return_on_equity: returnOnEquity,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'address,coin' });
  }
  
  // Remove closed positions
  for (const coin of existingCoins) {
    if (!currentCoins.has(coin)) {
      await db.client
        .from('trader_positions')
        .delete()
        .eq('address', address.toLowerCase())
        .eq('coin', coin);
    }
  }
}

async function pollQualityTraders(): Promise<void> {
  // Get all tracked traders (ELITE and GOOD)
  const result = await db.client
    .from('trader_quality')
    .select('address, quality_tier, pnl_7d, win_rate')
    .eq('is_tracked', true)
    .in('quality_tier', ['elite', 'good']);
  
  if (result.error || !result.data || result.data.length === 0) {
    return;
  }
  
  const traders = result.data;
  logger.info('Polling positions for ' + traders.length + ' quality traders');
  
  // Process in batches
  for (let i = 0; i < traders.length; i += BATCH_SIZE) {
    const batch = traders.slice(i, i + BATCH_SIZE);
    
    await Promise.all(
      batch.map(trader => 
        updateTraderPositions(
          trader.address, 
          trader.quality_tier,
          trader.pnl_7d,
          trader.win_rate
        )
      )
    );
    
    if (i + BATCH_SIZE < traders.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
    }
  }
  
  // After updating positions, check for convergence signals
  await generateSignals();
}

let pollInterval: NodeJS.Timeout | null = null;

export function startPositionTracker(): void {
  logger.info('Starting position tracker...');
  logger.info('Tracking assets: ' + MAJOR_ASSETS.join(', '));
  logger.info('Minimum position: $' + MIN_POSITION_VALUE);
  
  // Initial poll after short delay (let analyzer run first)
  setTimeout(pollQualityTraders, 10000);
  
  // Start interval
  pollInterval = setInterval(pollQualityTraders, POLL_INTERVAL);
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
  
  const positions = result.data || [];
  const uniqueCoins = new Set(positions.map((p: { coin: string }) => p.coin));
  
  return {
    totalPositions: positions.length,
    uniqueCoins: uniqueCoins.size,
  };
}

export default { startPositionTracker, stopPositionTracker, getPositionStats };