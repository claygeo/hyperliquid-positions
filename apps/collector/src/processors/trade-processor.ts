// Trade processor - processes incoming trades from WebSocket

import { createLogger } from '../utils/logger.js';
import { bulkInsertTrades } from '../db/trades.js';
import { processTradeForAlpha, flushAlphaBuffer } from './alpha-detector.js';
import type { DBTradeInsert } from '@hyperliquid-tracker/shared';

const logger = createLogger('processor:trade');

// Buffer for batch inserts
let tradeBuffer: DBTradeInsert[] = [];
const BUFFER_SIZE = 50;
const FLUSH_INTERVAL = 10000; // 10 seconds

/**
 * Process a single trade from the WebSocket stream
 */
export function processTrade(trade: {
  user: string;
  coin: string;
  side: string;
  px: string;
  sz: string;
  time: number;
  hash: string;
  oid: number;
  closedPnl?: string;
  dir?: string;
}): void {
  const closedPnl = parseFloat(trade.closedPnl || '0');
  const price = parseFloat(trade.px);
  const size = parseFloat(trade.sz);
  const timestamp = new Date(trade.time);

  // Create trade record
  const tradeRecord: DBTradeInsert = {
    wallet: trade.user.toLowerCase(),
    coin: trade.coin,
    side: trade.side === 'B' ? 'buy' : 'sell',
    price: price,
    size: size,
    notional: price * size,
    tx_hash: trade.hash,
    oid: trade.oid,
    timestamp: timestamp.toISOString(),
    closed_pnl: closedPnl,
  };

  // Add to buffer
  tradeBuffer.push(tradeRecord);

  // Process for alpha detection (this is in-memory, fast)
  processTradeForAlpha({
    wallet: trade.user,
    coin: trade.coin,
    side: trade.side,
    price: price,
    size: size,
    closedPnl: closedPnl,
    timestamp: timestamp,
  });

  // Flush if buffer is full
  if (tradeBuffer.length >= BUFFER_SIZE) {
    flushTradeBuffer();
  }
}

/**
 * Flush trade buffer to database
 */
async function flushTradeBuffer(): Promise<void> {
  if (tradeBuffer.length === 0) return;

  const trades = [...tradeBuffer];
  tradeBuffer = [];

  try {
    const inserted = await bulkInsertTrades(trades);
    if (inserted > 0) {
      logger.debug(`Inserted ${inserted} trades`);
    }
  } catch (error) {
    logger.error('Failed to flush trade buffer', error);
  }
}

/**
 * Flush all pending data (trades + alpha metrics)
 */
export async function flushPendingData(): Promise<void> {
  await flushTradeBuffer();
  await flushAlphaBuffer();
}

/**
 * Start periodic flush interval
 */
export function startFlushInterval(): NodeJS.Timeout {
  return setInterval(() => {
    flushTradeBuffer();
  }, FLUSH_INTERVAL);
}

export default {
  processTrade,
  flushPendingData,
  startFlushInterval,
};