// Wallet fills collector - tracks fills for watched wallets

import { HyperliquidWebSocket, type HLUserFills } from '@hyperliquid-tracker/sdk';
import { createLogger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import CONFIG from '../config.js';
import { getWalletAddresses } from '../db/wallets.js';
import { processFill } from '../processors/trade-processor.js';

const logger = createLogger('collector:fills');

export class WalletFillsCollector {
  private ws: HyperliquidWebSocket;
  private unsubscribers: Map<string, () => void> = new Map();
  private isRunning = false;
  private watchedWallets: Set<string> = new Set();
  private refreshInterval: NodeJS.Timeout | null = null;
  private readonly REFRESH_INTERVAL_MS = 60000; // Refresh wallet list every minute

  constructor() {
    this.ws = new HyperliquidWebSocket({
      url: CONFIG.hyperliquid.wsUrl,
      reconnectInterval: 5000,
      maxReconnectAttempts: -1,
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Wallet fills collector already running');
      return;
    }

    logger.info('Starting wallet fills collector');
    this.isRunning = true;

    this.ws.onConnect(() => {
      logger.info('Fills WebSocket connected');
      // Resubscribe to all wallets on reconnect
      this.resubscribeAll();
    });

    this.ws.onDisconnect(() => {
      logger.warn('Fills WebSocket disconnected');
    });

    this.ws.onError((error) => {
      logger.error('Fills WebSocket error', error);
    });

    await this.ws.connect();

    // Load initial wallet list and subscribe
    await this.refreshWalletList();

    // Set up periodic refresh of wallet list
    this.refreshInterval = setInterval(() => {
      this.refreshWalletList();
    }, this.REFRESH_INTERVAL_MS);

    logger.info('Wallet fills collector started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping wallet fills collector');
    this.isRunning = false;

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    // Unsubscribe from all wallets
    for (const [wallet, unsubscribe] of this.unsubscribers) {
      unsubscribe();
      logger.debug(`Unsubscribed from ${wallet}`);
    }
    this.unsubscribers.clear();
    this.watchedWallets.clear();

    this.ws.disconnect();
    logger.info('Wallet fills collector stopped');
  }

  async addWallet(address: string): Promise<void> {
    if (this.watchedWallets.has(address)) return;

    const unsubscribe = this.ws.subscribeToUserFills(address, (data) => {
      this.handleFills(address, data);
    });

    this.unsubscribers.set(address, unsubscribe);
    this.watchedWallets.add(address);
    logger.debug(`Subscribed to fills for ${address}`);
    metrics.gauge('watched_wallets', this.watchedWallets.size);
  }

  removeWallet(address: string): void {
    const unsubscribe = this.unsubscribers.get(address);
    if (unsubscribe) {
      unsubscribe();
      this.unsubscribers.delete(address);
      this.watchedWallets.delete(address);
      logger.debug(`Unsubscribed from fills for ${address}`);
      metrics.gauge('watched_wallets', this.watchedWallets.size);
    }
  }

  private async refreshWalletList(): Promise<void> {
    try {
      const addresses = await getWalletAddresses();
      const addressSet = new Set(addresses);

      // Add new wallets
      for (const address of addresses) {
        if (!this.watchedWallets.has(address)) {
          await this.addWallet(address);
        }
      }

      // Remove wallets no longer in the list
      for (const address of this.watchedWallets) {
        if (!addressSet.has(address)) {
          this.removeWallet(address);
        }
      }

      logger.debug(`Watching ${this.watchedWallets.size} wallets for fills`);
    } catch (error) {
      logger.error('Error refreshing wallet list', error);
    }
  }

  private resubscribeAll(): void {
    // Clear existing subscriptions
    for (const [, unsubscribe] of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.clear();

    // Resubscribe to all watched wallets
    for (const address of this.watchedWallets) {
      const unsubscribe = this.ws.subscribeToUserFills(address, (data) => {
        this.handleFills(address, data);
      });
      this.unsubscribers.set(address, unsubscribe);
    }

    logger.info(`Resubscribed to ${this.watchedWallets.size} wallets`);
  }

  private async handleFills(wallet: string, data: HLUserFills): Promise<void> {
    // Skip snapshot messages
    if (data.isSnapshot) return;

    metrics.increment('wallet_fills_received', data.fills.length);

    for (const fill of data.fills) {
      try {
        await processFill(wallet, fill);
      } catch (error) {
        logger.error('Error processing fill', { error, wallet, hash: fill.hash });
      }
    }
  }

  getWatchedCount(): number {
    return this.watchedWallets.size;
  }
}

let collector: WalletFillsCollector | null = null;

export function getWalletFillsCollector(): WalletFillsCollector {
  if (!collector) {
    collector = new WalletFillsCollector();
  }
  return collector;
}

export default WalletFillsCollector;
