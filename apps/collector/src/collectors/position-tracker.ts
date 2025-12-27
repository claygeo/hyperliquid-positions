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

interface PositionChangeRecord {
  wallet: string;
  coin: string;
  change_type: string;
  direction: string;
  old_size: number;
  new_size: number;
  entry_price: number;
  value_usd: number;
  unrealized_pnl: number;
  return_on_equity: number;
  position_pct: number;
  account_value: number;
  is_winning: boolean;
  detected_at: string;
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
    
    var positions: PositionFromAPI[] = [];
    if (data.assetPositions) {
      for (var i = 0; i < data.assetPositions.length; i++) {
        var ap = data.assetPositions[i];
        if (ap.position && parseFloat(ap.position.szi) !== 0) {
          positions.push(ap.position);
        }
      }
    }

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
  var changes: PositionChangeRecord[] = [];

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
        change_type: changeType,
        direction: direction,
        old_size: oldSize,
        new_size: absSize,
        entry_price: entryPrice,
        value_usd: valueUsd,
        unrealized_pnl: unrealizedPnl,
        return_on_equity: returnOnEquity,
        position_pct: positionPct,
        account_value: accountValue,
        is_winning: isWinning,
        detected_at: new Date().toISOString(),
      });

      var pnlStr = unrealizedPnl >= 0 ? '+$' + Math.round(unrealizedPnl) : '-$' + Math.abs(Math.round(unrealizedPnl));
      var roePct = (returnOnEquity * 100).toFixed(1);
      logger.info(
        '📊 ' + wallet.slice(0, 10) + '... ' + changeType.toUpperCase() + ' ' + direction.toUpperCase() + ' ' + coin +
        ' - $' + Math.round(valueUsd) + ' | PnL: ' + pnlStr + ' (' + roePct + '%)'
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
  var cachedCoins = Array.from(walletCache.keys());
  for (var j = 0; j < cachedCoins.length; j++) {
    var cachedCoin = cachedCoins[j];
    var cachedPos = walletCache.get(cachedCoin);
    if (!cachedPos) continue;
    
    var stillOpen = false;
    for (var k = 0; k < positions.length; k++) {
      if (positions[k].coin === cachedCoin) {
        stillOpen = true;
        break;
      }
    }
    
    if (!stillOpen) {
      var isMajor = MAJOR_ASSETS.indexOf(cachedCoin) !== -1;
      if (isMajor && cachedPos.valueUsd > 10000) {
        changes.push({
          wallet: wallet,
          coin: cachedCoin,
          change_type: 'close',
          direction: cachedPos.direction,
          old_size: cachedPos.size,
          new_size: 0,
          entry_price: cachedPos.entryPrice,
          value_usd: 0,
          unrealized_pnl: 0,
          return_on_equity: 0,
          position_pct: 0,
          account_value: accountValue,
          is_winning: false,
          detected_at: new Date().toISOString(),
        });

        logger.info('📊 ' + wallet.slice(0, 10) + '... CLOSE ' + cachedPos.direction.toUpperCase() + ' ' + cachedCoin);
      }
      walletCache.delete(cachedCoin);
    }
  }

  positionCache.set(wallet, walletCache);

  // Save changes to database
  if (changes.length > 0) {
    await savePositionChanges(changes);
  }
}

async function savePositionChanges(changes: PositionChangeRecord[]): Promise<void> {
  var result = await db.client.from('position_changes').insert(changes);

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

  var wallets: string[] = [];
  for (var i = 0; i < result.data.length; i++) {
    wallets.push(result.data[i].address);
  }

  // Process in batches
  for (var j = 0; j < wallets.length; j += BATCH_SIZE) {
    var batch = wallets.slice(j, j + BATCH_SIZE);
    var promises: Promise<void>[] = [];
    for (var k = 0; k < batch.length; k++) {
      promises.push(processWalletPositions(batch[k]));
    }
    await Promise.all(promises);
    
    if (j + BATCH_SIZE < wallets.length) {
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