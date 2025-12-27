// Trade stream collector - streams all trades from Hyperliquid

import { HyperliquidWebSocket, type HLTrade } from '@hyperliquid-tracker/sdk';
import { MAJOR_COINS } from '@hyperliquid-tracker/shared';
import { createLogger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import CONFIG from '../config.js';
import { processTrade } from '../processors/trade-processor.js';

const logger = createLogger('collector:trades');

export class TradeStreamCollector {
  private ws: HyperliquidWebSocket;
  private unsubscribers: (() => void)[] = [];
  private isRunning = false;
  private tradeBuffer: HLTrade[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly BUFFER_SIZE = 100;
  private readonly FLUSH_INTERVAL_MS = 5000;

  constructor() {
    this.ws = new HyperliquidWebSocket({
      url: CONFIG.hyperliquid.wsUrl,
      reconnectInterval: 5000,
      maxReconnectAttempts: -1, // Infinite reconnects
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Trade stream collector already running');
      return;
    }

    logger.info('Starting trade stream collector');
    this.isRunning = true;

    // Set up event handlers
    this.ws.onConnect(() => {
      logger.info('WebSocket connected');
      metrics.increment('ws_connections');
    });

    this.ws.onDisconnect(() => {
      logger.warn('WebSocket disconnected');
      metrics.increment('ws_disconnections');
    });

    this.ws.onError((error) => {
      logger.error('WebSocket error', error);
      metrics.increment('ws_errors');
    });

    // Connect to WebSocket
    await this.ws.connect();

    // Subscribe to trades for major coins
    for (const coin of MAJOR_COINS) {
      const unsubscribe = this.ws.subscribeToTrades(coin, (trades) => {
        this.handleTrades(trades);
      });
      this.unsubscribers.push(unsubscribe);
      logger.debug(`Subscribed to ${coin} trades`);
    }

    // Start flush interval
    this.flushInterval = setInterval(() => {
      this.flushBuffer();
    }, this.FLUSH_INTERVAL_MS);

    logger.info(`Subscribed to ${MAJOR_COINS.length} coin trade streams`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping trade stream collector');
    this.isRunning = false;

    // Clear flush interval
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Flush remaining trades
    await this.flushBuffer();

    // Unsubscribe from all streams
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];

    // Disconnect WebSocket
    this.ws.disconnect();

    logger.info('Trade stream collector stopped');
  }

  private handleTrades(trades: HLTrade[]): void {
    metrics.increment('trades_received', trades.length);
    
    // Add to buffer
    this.tradeBuffer.push(...trades);
    
    // Flush if buffer is full
    if (this.tradeBuffer.length >= this.BUFFER_SIZE) {
      this.flushBuffer();
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.tradeBuffer.length === 0) return;

    const trades = [...this.tradeBuffer];
    this.tradeBuffer = [];

    try {
      // Process trades in parallel (with concurrency limit)
      const batchSize = 50;
      for (let i = 0; i < trades.length; i += batchSize) {
        const batch = trades.slice(i, i + batchSize);
        await Promise.all(batch.map(trade => this.processTradeWithErrorHandling(trade)));
      }
      
      metrics.increment('trades_processed', trades.length);
      logger.debug(`Processed ${trades.length} trades`);
    } catch (error) {
      logger.error('Error flushing trade buffer', error);
      metrics.increment('trades_process_errors');
    }
  }

  private async processTradeWithErrorHandling(trade: HLTrade): Promise<void> {
    try {
      await processTrade(trade);
    } catch (error) {
      logger.error('Error processing trade', { error, trade: trade.hash });
      metrics.increment('trade_process_error');
    }
  }

  isConnected(): boolean {
    return this.ws.isConnected();
  }
}

// Singleton instance
let collector: TradeStreamCollector | null = null;

export function getTradeStreamCollector(): TradeStreamCollector {
  if (!collector) {
    collector = new TradeStreamCollector();
  }
  return collector;
}

export default TradeStreamCollector;
