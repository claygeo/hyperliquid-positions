// Hyperliquid WebSocket Connection Manager

import WebSocket from 'ws';
import type {
  HLSubscription,
  HLWebSocketMessage,
  HLTrade,
  HLUserFills,
  HLAllMids,
  HLBook,
} from '@hyperliquid-tracker/shared';

export type MessageHandler = (data: unknown) => void;
export type ErrorHandler = (error: Error) => void;
export type ConnectionHandler = () => void;

export interface WebSocketConfig {
  url?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
}

const DEFAULT_WS_URL = 'wss://api.hyperliquid.xyz/ws';
const DEFAULT_RECONNECT_INTERVAL = 5000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
const DEFAULT_PING_INTERVAL = 30000;

export class HyperliquidWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private pingInterval: number;
  private reconnectAttempts = 0;
  private subscriptions: Map<string, HLSubscription> = new Map();
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private errorHandlers: Set<ErrorHandler> = new Set();
  private connectHandlers: Set<ConnectionHandler> = new Set();
  private disconnectHandlers: Set<ConnectionHandler> = new Set();
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private shouldReconnect = true;

  constructor(config: WebSocketConfig = {}) {
    this.url = config.url || DEFAULT_WS_URL;
    this.reconnectInterval = config.reconnectInterval || DEFAULT_RECONNECT_INTERVAL;
    this.maxReconnectAttempts = config.maxReconnectAttempts || DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.pingInterval = config.pingInterval || DEFAULT_PING_INTERVAL;
  }

  /**
   * Connect to WebSocket
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
          console.log('[WS] Connected to Hyperliquid');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.startPing();
          this.resubscribe();
          this.connectHandlers.forEach(handler => handler());
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString()) as HLWebSocketMessage;
            this.handleMessage(message);
          } catch (error) {
            console.error('[WS] Failed to parse message:', error);
          }
        });

        this.ws.on('error', (error: Error) => {
          console.error('[WS] Error:', error);
          this.errorHandlers.forEach(handler => handler(error));
          if (this.isConnecting) {
            reject(error);
          }
        });

        this.ws.on('close', () => {
          console.log('[WS] Connection closed');
          this.isConnecting = false;
          this.stopPing();
          this.disconnectHandlers.forEach(handler => handler());
          this.attemptReconnect();
        });

        this.ws.on('pong', () => {
          // Connection is alive
        });
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Subscribe to a channel
   */
  subscribe(subscription: HLSubscription, handler: MessageHandler): () => void {
    const key = this.getSubscriptionKey(subscription);
    
    // Store subscription
    this.subscriptions.set(key, subscription);
    
    // Add handler
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }
    this.handlers.get(key)!.add(handler);
    
    // Send subscription if connected
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({
        method: 'subscribe',
        subscription,
      });
    }
    
    // Return unsubscribe function
    return () => this.unsubscribe(subscription, handler);
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(subscription: HLSubscription, handler?: MessageHandler): void {
    const key = this.getSubscriptionKey(subscription);
    
    if (handler) {
      this.handlers.get(key)?.delete(handler);
      if (this.handlers.get(key)?.size === 0) {
        this.handlers.delete(key);
        this.subscriptions.delete(key);
        this.sendUnsubscribe(subscription);
      }
    } else {
      this.handlers.delete(key);
      this.subscriptions.delete(key);
      this.sendUnsubscribe(subscription);
    }
  }

  /**
   * Subscribe to all trades for a coin
   */
  subscribeToTrades(coin: string, handler: (trades: HLTrade[]) => void): () => void {
    return this.subscribe({ type: 'trades', coin }, handler as MessageHandler);
  }

  /**
   * Subscribe to all mid prices
   */
  subscribeToAllMids(handler: (mids: HLAllMids) => void): () => void {
    return this.subscribe({ type: 'allMids' }, handler as MessageHandler);
  }

  /**
   * Subscribe to user fills
   */
  subscribeToUserFills(user: string, handler: (fills: HLUserFills) => void): () => void {
    return this.subscribe({ type: 'userFills', user }, handler as MessageHandler);
  }

  /**
   * Subscribe to order book
   */
  subscribeToL2Book(coin: string, handler: (book: HLBook) => void): () => void {
    return this.subscribe({ type: 'l2Book', coin }, handler as MessageHandler);
  }

  /**
   * Add error handler
   */
  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  /**
   * Add connect handler
   */
  onConnect(handler: ConnectionHandler): () => void {
    this.connectHandlers.add(handler);
    return () => this.connectHandlers.delete(handler);
  }

  /**
   * Add disconnect handler
   */
  onDisconnect(handler: ConnectionHandler): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private handleMessage(message: HLWebSocketMessage): void {
    const { channel, data } = message;
    
    // Handle subscription response
    if (channel === 'subscriptionResponse') {
      console.log('[WS] Subscription confirmed:', data);
      return;
    }
    
    // Route to appropriate handlers
    this.handlers.forEach((handlers, key) => {
      const subscription = this.subscriptions.get(key);
      if (subscription && this.matchesChannel(subscription, channel)) {
        handlers.forEach(handler => handler(data));
      }
    });
  }

  private matchesChannel(subscription: HLSubscription, channel: string): boolean {
    // Map subscription types to channel names
    const channelMap: Record<string, string> = {
      allMids: 'allMids',
      trades: 'trades',
      l2Book: 'l2Book',
      userFills: 'userFills',
      userFundings: 'userFundings',
      orderUpdates: 'orderUpdates',
      notification: 'notification',
      webData2: 'webData2',
      candle: 'candle',
    };
    
    return channelMap[subscription.type] === channel;
  }

  private getSubscriptionKey(subscription: HLSubscription): string {
    const parts = [subscription.type];
    if (subscription.coin) parts.push(subscription.coin);
    if (subscription.user) parts.push(subscription.user);
    if (subscription.interval) parts.push(subscription.interval);
    return parts.join(':');
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private sendUnsubscribe(subscription: HLSubscription): void {
    this.send({
      method: 'unsubscribe',
      subscription,
    });
  }

  private resubscribe(): void {
    this.subscriptions.forEach(subscription => {
      this.send({
        method: 'subscribe',
        subscription,
      });
    });
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.pingInterval);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private attemptReconnect(): void {
    if (!this.shouldReconnect) return;
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnection attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    console.log(`[WS] Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
    
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(error => {
        console.error('[WS] Reconnection failed:', error);
      });
    }, this.reconnectInterval);
  }
}

export default HyperliquidWebSocket;
