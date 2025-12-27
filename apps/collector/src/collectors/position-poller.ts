// Position poller - periodically fetches positions for watched wallets

import { HyperliquidClient, extractPositions } from '@hyperliquid-tracker/sdk';
import type { DBPositionUpsert } from '@hyperliquid-tracker/shared';
import { createLogger } from '../utils/logger.js';
import { metrics, trackTiming } from '../utils/metrics.js';
import { retry } from '../utils/retry.js';
import CONFIG from '../config.js';
import { getActiveWallets } from '../db/wallets.js';
import { bulkUpsertPositions, deleteClosedPositions } from '../db/positions.js';

const logger = createLogger('collector:positions');

export class PositionPoller {
  private client: HyperliquidClient;
  private isRunning = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 10;
  private readonly BATCH_DELAY_MS = 500;

  constructor() {
    this.client = new HyperliquidClient({
      apiUrl: CONFIG.hyperliquid.apiUrl,
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Position poller already running');
      return;
    }

    logger.info('Starting position poller');
    this.isRunning = true;

    // Initial poll
    await this.poll();

    // Set up periodic polling
    this.pollInterval = setInterval(() => {
      this.poll();
    }, CONFIG.collector.positionPollIntervalMs);

    logger.info(`Position poller started (interval: ${CONFIG.collector.positionPollIntervalMs}ms)`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping position poller');
    this.isRunning = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    logger.info('Position poller stopped');
  }

  private async poll(): Promise<void> {
    await trackTiming('position_poll', async () => {
      try {
        const wallets = await getActiveWallets(500);
        logger.debug(`Polling positions for ${wallets.length} wallets`);

        let updated = 0;
        let errors = 0;

        // Process in batches to avoid rate limits
        for (let i = 0; i < wallets.length; i += this.BATCH_SIZE) {
          const batch = wallets.slice(i, i + this.BATCH_SIZE);
          
          const results = await Promise.allSettled(
            batch.map(wallet => this.fetchWalletPositions(wallet.address))
          );

          for (let j = 0; j < results.length; j++) {
            const result = results[j];
            if (result.status === 'fulfilled' && result.value) {
              updated++;
            } else if (result.status === 'rejected') {
              errors++;
              logger.error('Failed to fetch positions', {
                wallet: batch[j].address,
                error: result.reason,
              });
            }
          }

          // Small delay between batches
          if (i + this.BATCH_SIZE < wallets.length) {
            await this.delay(this.BATCH_DELAY_MS);
          }
        }

        metrics.increment('positions_updated', updated);
        metrics.increment('position_errors', errors);
        logger.info(`Position poll complete: ${updated} updated, ${errors} errors`);
      } catch (error) {
        logger.error('Position poll failed', error);
        metrics.increment('position_poll_failures');
      }
    });
  }

  private async fetchWalletPositions(address: string): Promise<boolean> {
    try {
      const state = await retry(
        () => this.client.getClearinghouseState(address),
        { maxAttempts: 2 }
      );

      const positions = extractPositions(state);
      const openCoins: string[] = [];

      if (positions.length > 0) {
        const dbPositions: DBPositionUpsert[] = positions
          .filter(p => parseFloat(p.szi) !== 0)
          .map(p => {
            openCoins.push(p.coin);
            return {
              wallet: address,
              coin: p.coin,
              size: parseFloat(p.szi),
              entry_price: parseFloat(p.entryPx),
              leverage: p.leverage.value,
              leverage_type: p.leverage.type,
              unrealized_pnl: parseFloat(p.unrealizedPnl),
              liquidation_price: p.liquidationPx ? parseFloat(p.liquidationPx) : null,
              margin_used: parseFloat(p.marginUsed),
            };
          });

        if (dbPositions.length > 0) {
          await bulkUpsertPositions(dbPositions);
        }
      }

      // Delete positions that are now closed
      await deleteClosedPositions(address, openCoins);

      return true;
    } catch (error) {
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

let poller: PositionPoller | null = null;

export function getPositionPoller(): PositionPoller {
  if (!poller) {
    poller = new PositionPoller();
  }
  return poller;
}

export default PositionPoller;
