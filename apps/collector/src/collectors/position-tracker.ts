// Position tracker - polls positions for leaderboard wallets with PnL tracking

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { detectConvergence } from '../processors/convergence-detector.js';

var logger = createLogger('collector:position-tracker');

var HYPERLIQUID_API = 'https://api.hyperliquid.xyz/info';
var POLL_INTERVAL = 60000; // 60 seconds
var BATCH_SIZE = 10;
var BATCH_DELAY = 500;

// Major assets we care about
var MAJOR_ASSETS = ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'DOGE', 'SUI', 'AVAX', 'LINK', 'BNB'];

// In-memory cache of positions
var positionCache = new Map<string, Map<string, CachedPosition>>();

interface CachedPosition {
  coin: string;
  size: number;
  direction: string;
  entryPrice: number;
  leverage: number;
  valueUsd: number;
  unrealizedPnl: number;
  returnOnEquity: number;
  accountValue: number;
  lastSeen: Date;
}

interface PositionFromAPI {
  coin: string;
  szi: string;
  entryPx: string;
  leverage: { value: string };
  positionValue: string;
  unrealizedPnl: string;
  returnOnEquity: string;
}

interface ClearinghouseResponse {
  assetPositions: Array<{
    position: PositionFromAPI;
  }>;
  marginSummary: {
    accountValue: string;
  };
}

async function fetchPositions(wallet: string): Promise<{ positions: PositionFromAPI[]; accountValue: number } | null> {
  try {
    var response = await fetch(HYPERLIQUID_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clearinghouseState', user: wallet }),
    });

    if (!response.ok) return null;

    var data = await response.json() as ClearinghouseResponse;
    var accountValue = parseFloat(data.marginSummary?.accountValue || '0');
    
    var positions = data.assetPositions
      ?.filter(function(p) { return p.position && parseFloat(p.position.szi) !== 0; })
      .map(function(p) { return p.position; }) || [];

    return { positions: positions, accountValue: accountValue };
  } catch (error) {
    logger.error('Failed to fetch positions for ' + wallet, error);
    return null;
  }
}

async function processWalletPositions(wallet: string): Promise<void> {
  var result = await fetchPositions(wallet);
  if (!result) return;

  var positions = result.positions;
  var accountValue = result.accountValue;
  var walletCache = positionCache.get(wallet) || new Map<string, CachedPosition>();
  var changes: Array<{
    wallet: string;
    coin: string;
    changeType: string;
    direction: string;
    oldSize: number;
    newSize: number;
    entryPrice: number;
    valueUsd: number;
    unrealizedPnl: number;
    returnOnEquity: number;
    positionPct: number;
    accountValue: number;
    isWinning: boolean;
  }> = [];

  // Check each position
  for (var i = 0; i < positions.length; i++) {
    var pos = positions[i];
    var coin = pos.coin;
    var size = parseFloat(pos.szi);
    var direction = size > 0 ? 'long' : 'short';
    var absSize = Math.abs(size);
    var entryPrice = parseFloat(pos.entryPx || '0');
    var leverage = parseFloat(pos.leverage?.value || '1');
    var valueUsd = parseFloat(pos.positionValue || '0');
    var unrealizedPnl = parseFloat(pos.unrealizedPnl || '0');
    var returnOnEquity = parseFloat(pos.returnOnEquity || '0');
    var positionPct = accountValue > 0 ? (valueUsd / accountValue) * 100 : 0;
    var isWinning = unrealizedPnl > 0;

    var cached = walletCache.get(coin);

    // Determine change type
    var changeType: string | null = null;
    var oldSize = 0;

    if (!cached) {
      // New position
      changeType = 'open';
    } else {
      oldSize = cached.size;
      var oldDirection = cached.direction;

      if (oldDirection !== direction) {
        // Flipped direction
        changeType = 'flip';
      } else {
        var sizeChange = Math.abs(absSize - oldSize) / oldSize;
        if (sizeChange > 0.25) {
          // Significant size change
          changeType = absSize > oldSize ? 'increase' : 'decrease';
        }
      }
    }

    // Only track changes for major assets
    var isMajorAsset = MAJOR_ASSETS.indexOf(coin) !== -1;

    if (changeType && isMajorAsset && valueUsd > 10000) {
      changes.push({
        wallet: wallet,
        coin: coin,
        changeType: changeType,
        direction: direction,
        oldSize: oldSize,
        newSize: absSize,
        entryPrice: entryPrice,
        valueUsd: valueUsd,
        unrealizedPnl: unrealizedPnl,
        returnOnEquity: returnOnEquity,
        positionPct: positionPct,
        accountValue: accountValue,
        isWinning: isWinning,
      });

      logger.info(
        '📊 ' + wallet.slice(0, 10) + '... ' + changeType.toUpperCase() + ' ' + direction.toUpperCase() + ' ' + coin +
        ' - $' + Math.round(valueUsd) +
        ' | PnL: ' + (unrealizedPnl >= 0 ? '+' : '') + '$' + Math.round(unrealizedPnl) +
        ' (' + (returnOnEquity * 100).toFixed(1) + '%)'
      );
    }

    // Update cache
    walletCache.set(coin, {
      coin: coin,
      size: absSize,
      direction: direction,
      entryPrice: entryPrice,
      leverage: leverage,
      valueUsd: valueUsd,
      unrealizedPnl: unrealizedPnl,
      returnOnEquity: returnOnEquity,
      accountValue: accountValue,
      lastSeen: new Date(),
    });
  }

  // Check for closed positions
  walletCache.forEach(function(cached, coin) {
    var stillOpen = positions.some(function(p) { return p.coin === coin; });
    if (!stillOpen) {
      var isMajorAsset = MAJOR_ASSETS.indexOf(coin) !== -1;
      if (isMajorAsset && cached.valueUsd > 10000) {
        changes.push({
          wallet: wallet,
          coin: coin,
          changeType: 'close',
          direction: cached.direction,
          oldSize: cached.size,
          newSize: 0,
          entryPrice: cached.entryPrice,
          valueUsd: 0,
          unrealizedPnl: 0,
          returnOnEquity: 0,
          positionPct: 0,
          accountValue: accountValue,
          isWinning: false,
        });

        logger.info('📊 ' + wallet.slice(0, 10) + '... CLOSE ' + cached.direction.toUpperCase() + ' ' + coin);
      }
      walletCache.delete(coin);
    }
  });

  positionCache.set(wallet, walletCache);

  // Save changes to database
  if (changes.length > 0) {
    await savePositionChanges(changes);
  }
}

async function savePositionChanges(changes: Array<{
  wallet: string;
  coin: string;
  changeType: string;
  direction: string;
  oldSize: number;
  newSize: number;
  entryPrice: number;
  valueUsd: number;
  unrealizedPnl: number;
  returnOnEquity: number;
  positionPct: number;
  accountValue: number;
  isWinning: boolean;
}>): Promise<void> {
  var records = changes.map(function(c) {
    return {
      wallet: c.wallet,
      coin: c.coin,
      change_type: c.changeType,
      direction: c.direction,
      old_size: c.oldSize,
      new_size: c.newSize,
      entry_price: c.entryPrice,
      value_usd: c.valueUsd,
      unrealized_pnl: c.unrealizedPnl,
      return_on_equity: c.returnOnEquity,
      position_pct: c.positionPct,
      account_value: c.accountValue,
      is_winning: c.isWinning,
      detected_at: new Date().toISOString(),
    };
  });

  var result = await db.client.from('position_changes').insert(records);

  if (result.error) {
    logger.error('Failed to save position changes', result.error);
  } else {
    logger.info('Detected ' + changes.length + ' position changes');
    // Trigger convergence detection
    await detectConvergence();
  }
}

async function pollAllWallets(): Promise<void> {
  // Get wallets from leaderboard
  var result = await db.client
    .from('leaderboard_wallets')
    .select('address')
    .limit(100);

  if (result.error || !result.data) {
    logger.error('Failed to get leaderboard wallets', result.error);
    return;
  }

  var wallets = result.data.map(function(w) { return w.address; });

  // Process in batches
  for (var i = 0; i < wallets.length; i += BATCH_SIZE) {
    var batch = wallets.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(processWalletPositions));
    
    if (i + BATCH_SIZE < wallets.length) {
      await new Promise(function(resolve) { setTimeout(resolve, BATCH_DELAY); });
    }
  }
}

var pollInterval: NodeJS.Timeout | null = null;

export function startPositionTracker(): void {
  logger.info('Position tracker started (tracking: ' + MAJOR_ASSETS.join(', ') + ')');
  
  // Initial poll
  pollAllWallets();
  
  // Start interval
  pollInterval = setInterval(pollAllWallets, POLL_INTERVAL);
}

export function stopPositionTracker(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  logger.info('Position tracker stopped');
}

export default { startPositionTracker, stopPositionTracker };