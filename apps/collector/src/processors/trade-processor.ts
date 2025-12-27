// Trade processor - parse and enrich incoming trades

import type { HLTrade, HLFill, DBTradeInsert, DBWalletInsert } from '@hyperliquid-tracker/shared';
import { createLogger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import { bulkInsertTrades } from '../db/trades.js';
import { upsertWallet, getWallet } from '../db/wallets.js';

const logger = createLogger('processor:trade');

// Track pending trades for batching
const pendingTrades: DBTradeInsert[] = [];
const pendingWallets: Map<string, DBWalletInsert> = new Map();
let flushTimeout: NodeJS.Timeout | null = null;
const FLUSH_DELAY_MS = 2000;
const MAX_BATCH_SIZE = 500;

/**
 * Process a trade from the WebSocket stream
 */
export async function processTrade(trade: HLTrade): Promise<void> {
  const [buyer, seller] = trade.users;
  const price = parseFloat(trade.px);
  const size = parseFloat(trade.sz);
  const timestamp = new Date(trade.time).toISOString();

  // Create trade records for both buyer and seller
  const buyerTrade: DBTradeInsert = {
    wallet: buyer,
    coin: trade.coin,
    side: 'B',
    size,
    price,
    timestamp,
    tx_hash: trade.hash,
    oid: trade.tid,
    is_taker: true, // Buyer is taker in this context
    fee: 0, // We don't have fee info from trades stream
  };

  const sellerTrade: DBTradeInsert = {
    wallet: seller,
    coin: trade.coin,
    side: 'A',
    size,
    price,
    timestamp,
    tx_hash: trade.hash,
    oid: trade.tid,
    is_taker: false,
    fee: 0,
  };

  // Add to pending trades
  pendingTrades.push(buyerTrade, sellerTrade);

  // Track wallets
  trackWallet(buyer, timestamp, size * price);
  trackWallet(seller, timestamp, size * price);

  // Schedule flush
  scheduleFlush();

  // Immediate flush if batch is large
  if (pendingTrades.length >= MAX_BATCH_SIZE) {
    await flushPendingData();
  }
}

/**
 * Process a fill from watched wallet subscription
 */
export async function processFill(wallet: string, fill: HLFill): Promise<void> {
  const trade: DBTradeInsert = {
    wallet,
    coin: fill.coin,
    side: fill.side,
    size: parseFloat(fill.sz),
    price: parseFloat(fill.px),
    timestamp: new Date(fill.time).toISOString(),
    tx_hash: fill.hash,
    oid: fill.oid,
    is_taker: fill.crossed,
    fee: parseFloat(fill.fee),
    closed_pnl: fill.closedPnl ? parseFloat(fill.closedPnl) : null,
  };

  pendingTrades.push(trade);
  trackWallet(wallet, trade.timestamp, trade.size * trade.price);
  
  scheduleFlush();

  if (pendingTrades.length >= MAX_BATCH_SIZE) {
    await flushPendingData();
  }

  // Log significant trades
  if (Math.abs(trade.size * trade.price) > 10000) {
    logger.info('Large fill processed', {
      wallet: wallet.slice(0, 10),
      coin: fill.coin,
      side: fill.side,
      notional: trade.size * trade.price,
    });
  }
}

/**
 * Track wallet for upsert
 */
function trackWallet(address: string, timestamp: string, volume: number): void {
  const existing = pendingWallets.get(address);
  
  if (existing) {
    existing.total_trades = (existing.total_trades || 0) + 1;
    existing.total_volume = (existing.total_volume || 0) + volume;
    existing.last_trade_at = timestamp;
  } else {
    pendingWallets.set(address, {
      address,
      first_seen: timestamp,
      total_trades: 1,
      total_volume: volume,
      last_trade_at: timestamp,
      is_active: true,
    });
  }
}

/**
 * Schedule a flush of pending data
 */
function scheduleFlush(): void {
  if (flushTimeout) return;
  
  flushTimeout = setTimeout(async () => {
    await flushPendingData();
  }, FLUSH_DELAY_MS);
}

/**
 * Flush pending trades and wallet updates to database
 */
async function flushPendingData(): Promise<void> {
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }

  const tradesToInsert = [...pendingTrades];
  const walletsToUpsert = Array.from(pendingWallets.values());
  
  pendingTrades.length = 0;
  pendingWallets.clear();

  if (tradesToInsert.length === 0 && walletsToUpsert.length === 0) {
    return;
  }

  try {
    // Insert trades
    if (tradesToInsert.length > 0) {
      await bulkInsertTrades(tradesToInsert);
      metrics.increment('trades_inserted', tradesToInsert.length);
    }

    // Update wallet stats
    if (walletsToUpsert.length > 0) {
      await updateWalletStats(walletsToUpsert);
      metrics.increment('wallets_updated', walletsToUpsert.length);
    }

    logger.debug(`Flushed ${tradesToInsert.length} trades, ${walletsToUpsert.length} wallets`);
  } catch (error) {
    logger.error('Error flushing pending data', error);
    metrics.increment('flush_errors');
  }
}

/**
 * Update wallet statistics incrementally
 */
async function updateWalletStats(wallets: DBWalletInsert[]): Promise<void> {
  for (const wallet of wallets) {
    try {
      const existing = await getWallet(wallet.address);
      
      if (existing) {
        // Increment existing stats
        await upsertWallet({
          address: wallet.address,
          total_trades: existing.total_trades + (wallet.total_trades || 0),
          total_volume: existing.total_volume + (wallet.total_volume || 0),
          last_trade_at: wallet.last_trade_at,
          is_active: true,
        });
      } else {
        // New wallet
        await upsertWallet(wallet);
      }
    } catch (error) {
      logger.error('Error updating wallet stats', { wallet: wallet.address, error });
    }
  }
}

// Export flush function for graceful shutdown
export { flushPendingData };
