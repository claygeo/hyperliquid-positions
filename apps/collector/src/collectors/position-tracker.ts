// Position Tracker - Poll positions and detect changes for convergence

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { getLeaderboardWallets } from './leaderboard-fetcher.js';
import { checkConvergence } from '../processors/convergence-detector.js';

const logger = createLogger('collector:position-tracker');

const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';
const POLL_INTERVAL = 60000; // Poll every 60 seconds
const BATCH_SIZE = 10; // Process wallets in batches to avoid rate limits
const BATCH_DELAY = 500; // Delay between batches

let pollInterval: NodeJS.Timeout | null = null;
let isRunning = false;

// In-memory cache of last known positions
const positionCache = new Map<string, Map<string, PositionData>>();

interface PositionData {
  coin: string;
  size: number;
  direction: 'long' | 'short';
  entryPrice: number;
  leverage: number;
  valueUsd: number;
}

interface HyperliquidPosition {
  position: {
    coin: string;
    szi: string;
    entryPx: string;
    leverage: {
      type: string;
      value: number;
    };
    unrealizedPnl: string;
    marginUsed: string;
    liquidationPx: string | null;
  };
}

interface ClearinghouseResponse {
  assetPositions?: HyperliquidPosition[];
  marginSummary?: {
    accountValue: string;
  };
}

/**
 * Fetch positions for a wallet from Hyperliquid API
 */
async function fetchWalletPositions(address: string): Promise<PositionData[]> {
  try {
    const response = await fetch(HYPERLIQUID_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clearinghouseState',
        user: address,
      }),
    });

    if (!response.ok) return [];

    const data = await response.json() as ClearinghouseResponse;
    const positions = data?.assetPositions || [];

    return positions
      .filter(p => parseFloat(p.position.szi) !== 0)
      .map(p => {
        const size = parseFloat(p.position.szi);
        const entryPrice = parseFloat(p.position.entryPx);
        return {
          coin: p.position.coin,
          size: Math.abs(size),
          direction: (size > 0 ? 'long' : 'short') as 'long' | 'short',
          entryPrice: entryPrice,
          leverage: p.position.leverage?.value || 1,
          valueUsd: Math.abs(size) * entryPrice,
        };
      });
  } catch (error) {
    logger.error(`Failed to fetch positions for ${address}`, error);
    return [];
  }
}

/**
 * Detect changes between old and new positions
 */
function detectChanges(
  wallet: string,
  oldPositions: Map<string, PositionData>,
  newPositions: PositionData[]
): Array<{
  wallet: string;
  coin: string;
  changeType: 'open' | 'close' | 'increase' | 'decrease' | 'flip';
  direction: 'long' | 'short';
  oldSize: number;
  newSize: number;
  sizeChangePct: number;
  entryPrice: number;
  valueUsd: number;
}> {
  const changes: Array<{
    wallet: string;
    coin: string;
    changeType: 'open' | 'close' | 'increase' | 'decrease' | 'flip';
    direction: 'long' | 'short';
    oldSize: number;
    newSize: number;
    sizeChangePct: number;
    entryPrice: number;
    valueUsd: number;
  }> = [];

  const newPositionMap = new Map(newPositions.map(p => [p.coin, p]));

  // Check for new and changed positions
  for (const newPos of newPositions) {
    const oldPos = oldPositions.get(newPos.coin);

    if (!oldPos) {
      // New position opened
      changes.push({
        wallet,
        coin: newPos.coin,
        changeType: 'open',
        direction: newPos.direction,
        oldSize: 0,
        newSize: newPos.size,
        sizeChangePct: 100,
        entryPrice: newPos.entryPrice,
        valueUsd: newPos.valueUsd,
      });
    } else if (oldPos.direction !== newPos.direction) {
      // Position flipped (was long, now short or vice versa)
      changes.push({
        wallet,
        coin: newPos.coin,
        changeType: 'flip',
        direction: newPos.direction,
        oldSize: oldPos.size,
        newSize: newPos.size,
        sizeChangePct: 100,
        entryPrice: newPos.entryPrice,
        valueUsd: newPos.valueUsd,
      });
    } else {
      // Same direction - check for size change
      const sizeDiff = newPos.size - oldPos.size;
      const sizeChangePct = oldPos.size > 0 ? (sizeDiff / oldPos.size) * 100 : 100;

      // Only log significant changes (>25% change or >$10k)
      if (Math.abs(sizeChangePct) >= 25 || Math.abs(sizeDiff * newPos.entryPrice) >= 10000) {
        changes.push({
          wallet,
          coin: newPos.coin,
          changeType: sizeDiff > 0 ? 'increase' : 'decrease',
          direction: newPos.direction,
          oldSize: oldPos.size,
          newSize: newPos.size,
          sizeChangePct: sizeChangePct,
          entryPrice: newPos.entryPrice,
          valueUsd: newPos.valueUsd,
        });
      }
    }
  }

  // Check for closed positions
  for (const [coin, oldPos] of oldPositions) {
    if (!newPositionMap.has(coin)) {
      changes.push({
        wallet,
        coin: coin,
        changeType: 'close',
        direction: oldPos.direction,
        oldSize: oldPos.size,
        newSize: 0,
        sizeChangePct: -100,
        entryPrice: oldPos.entryPrice,
        valueUsd: 0,
      });
    }
  }

  return changes;
}

/**
 * Save position change to database
 */
async function savePositionChange(change: {
  wallet: string;
  coin: string;
  changeType: string;
  direction: string;
  oldSize: number;
  newSize: number;
  sizeChangePct: number;
  entryPrice: number;
  valueUsd: number;
}): Promise<void> {
  const { error } = await db.client
    .from('position_changes')
    .insert({
      wallet: change.wallet,
      coin: change.coin,
      change_type: change.changeType,
      direction: change.direction,
      old_size: change.oldSize,
      new_size: change.newSize,
      size_change_pct: change.sizeChangePct,
      entry_price: change.entryPrice,
      value_usd: change.valueUsd,
      detected_at: new Date().toISOString(),
    });

  if (error) {
    logger.error('Failed to save position change', error);
  }
}

/**
 * Save position snapshot to database
 */
async function savePositionSnapshot(wallet: string, position: PositionData): Promise<void> {
  const { error } = await db.client
    .from('position_snapshots')
    .insert({
      wallet: wallet,
      coin: position.coin,
      size: position.size,
      direction: position.direction,
      entry_price: position.entryPrice,
      leverage: position.leverage,
      value_usd: position.valueUsd,
      snapshot_at: new Date().toISOString(),
    });

  if (error && error.code !== '23505') { // Ignore duplicate key errors
    logger.error('Failed to save position snapshot', error);
  }
}

/**
 * Process a single wallet
 */
async function processWallet(wallet: string): Promise<number> {
  const newPositions = await fetchWalletPositions(wallet);
  
  // Get cached positions
  const oldPositions = positionCache.get(wallet) || new Map<string, PositionData>();
  
  // Detect changes
  const changes = detectChanges(wallet, oldPositions, newPositions);
  
  // Save changes and log significant ones
  for (const change of changes) {
    await savePositionChange(change);
    
    // Log significant changes
    if (change.changeType === 'open' || change.changeType === 'flip') {
      logger.info(`📊 ${wallet.slice(0, 10)}... ${change.changeType.toUpperCase()} ${change.direction.toUpperCase()} ${change.coin} - $${change.valueUsd.toFixed(0)}`);
    }
  }
  
  // Update cache
  const newCache = new Map<string, PositionData>();
  for (const pos of newPositions) {
    newCache.set(pos.coin, pos);
    await savePositionSnapshot(wallet, pos);
  }
  positionCache.set(wallet, newCache);
  
  return changes.length;
}

/**
 * Poll all tracked wallets
 */
async function pollAllWallets(): Promise<void> {
  const wallets = await getLeaderboardWallets(100);
  
  if (wallets.length === 0) {
    logger.debug('No wallets to poll');
    return;
  }

  logger.debug(`Polling ${wallets.length} wallets...`);
  
  let totalChanges = 0;
  
  // Process in batches
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    
    const results = await Promise.all(
      batch.map(wallet => processWallet(wallet).catch(() => 0))
    );
    
    totalChanges += results.reduce((a, b) => a + b, 0);
    
    // Delay between batches
    if (i + BATCH_SIZE < wallets.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
    }
  }
  
  if (totalChanges > 0) {
    logger.info(`Detected ${totalChanges} position changes`);
    
    // Check for convergence after detecting changes
    await checkConvergence();
  }
}

/**
 * Start position tracking
 */
export async function startPositionTracker(): Promise<void> {
  isRunning = true;
  
  // Initial poll
  await pollAllWallets();
  
  // Start polling interval
  pollInterval = setInterval(() => {
    if (isRunning) {
      pollAllWallets().catch(err => {
        logger.error('Position poll failed', err);
      });
    }
  }, POLL_INTERVAL);
  
  logger.info('Position tracker started');
}

/**
 * Stop position tracking
 */
export async function stopPositionTracker(): Promise<void> {
  isRunning = false;
  
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  
  logger.info('Position tracker stopped');
}

export default {
  startPositionTracker,
  stopPositionTracker,
  pollAllWallets,
};