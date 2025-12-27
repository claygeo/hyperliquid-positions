// Trade stream collector - WebSocket connection to Hyperliquid

import { createLogger } from '../utils/logger.js';
import { processTrade, startFlushInterval } from '../processors/trade-processor.js';
import { startAlphaFlushInterval } from '../processors/alpha-detector.js';

const logger = createLogger('collector:trade-stream');

const WS_URL = 'wss://api.hyperliquid.xyz/ws';

let ws: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let flushInterval: NodeJS.Timeout | null = null;
let alphaFlushInterval: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Connect to WebSocket
 */
function connect(): void {
  if (ws) {
    ws.close();
  }

  logger.info('Connecting to Hyperliquid WebSocket...');

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    logger.info('WebSocket connected');

    // Subscribe to all trades
    ws?.send(JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'trades' }
    }));

    logger.info('Subscribed to trades stream');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data.toString());

      if (data.channel === 'trades' && data.data) {
        for (const trade of data.data) {
          processTrade(trade);
        }
      }
    } catch (error) {
      logger.error('Failed to process WebSocket message', error);
    }
  };

  ws.onerror = (error) => {
    logger.error('WebSocket error', error);
  };

  ws.onclose = () => {
    logger.warn('WebSocket closed');

    if (isRunning) {
      // Reconnect after delay
      reconnectTimeout = setTimeout(() => {
        logger.info('Attempting reconnect...');
        connect();
      }, 5000);
    }
  };
}

/**
 * Start the trade stream collector
 */
export async function startTradeStream(): Promise<void> {
  isRunning = true;

  // Start flush intervals
  flushInterval = startFlushInterval();
  alphaFlushInterval = startAlphaFlushInterval();

  // Connect to WebSocket
  connect();

  logger.info('Trade stream collector started');
}

/**
 * Stop the trade stream collector
 */
export async function stopTradeStream(): Promise<void> {
  isRunning = false;

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }

  if (alphaFlushInterval) {
    clearInterval(alphaFlushInterval);
    alphaFlushInterval = null;
  }

  if (ws) {
    ws.close();
    ws = null;
  }

  logger.info('Trade stream collector stopped');
}

/**
 * Get collector instance
 */
export function getTradeStreamCollector() {
  return {
    start: startTradeStream,
    stop: stopTradeStream,
  };
}

export default {
  startTradeStream,
  stopTradeStream,
  getTradeStreamCollector,
};