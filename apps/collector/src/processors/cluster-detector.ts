// Cluster detector - detects coordinated trading patterns

import { createLogger } from '../utils/logger.js';
import { getTrackedWallets } from '../db/wallets.js';
import { getRecentTrades } from '../db/trades.js';

const logger = createLogger('processors:cluster-detector');

interface ClusterSignal {
  coin: string;
  wallets: string[];
  direction: 'long' | 'short';
  avgPrice: number;
  totalSize: number;
  confidence: number;
  timestamp: Date;
}

/**
 * Detect clusters of wallets trading the same coin
 */
export async function detectClusters(): Promise<ClusterSignal[]> {
  logger.info('Running cluster detection');

  try {
    const wallets = await getTrackedWallets();
    const recentTrades = await getRecentTrades(1000);

    if (recentTrades.length === 0) {
      logger.debug('No recent trades for cluster detection');
      return [];
    }

    // Group trades by coin and time window (5 minutes)
    const timeWindow = 5 * 60 * 1000;
    const now = Date.now();
    const clusters = new Map<string, any[]>();

    for (const trade of recentTrades) {
      const tradeTime = new Date(trade.timestamp).getTime();
      if (now - tradeTime > timeWindow) continue;

      const key = `${trade.coin}-${trade.side}`;
      if (!clusters.has(key)) {
        clusters.set(key, []);
      }
      clusters.get(key)!.push(trade);
    }

    // Find clusters with multiple wallets
    const signals: ClusterSignal[] = [];

    for (const [key, trades] of clusters) {
      const uniqueWallets = [...new Set(trades.map((t: any) => t.wallet))];

      if (uniqueWallets.length >= 2) {
        const [coin, side] = key.split('-');
        const totalSize = trades.reduce((sum: number, t: any) => sum + t.size, 0);
        const avgPrice = trades.reduce((sum: number, t: any) => sum + t.price, 0) / trades.length;

        signals.push({
          coin,
          wallets: uniqueWallets,
          direction: side === 'buy' ? 'long' : 'short',
          avgPrice,
          totalSize,
          confidence: Math.min(100, uniqueWallets.length * 25),
          timestamp: new Date(),
        });
      }
    }

    if (signals.length > 0) {
      logger.info(`Detected ${signals.length} cluster signals`);
    }

    return signals;
  } catch (error) {
    logger.error('Cluster detection failed', error);
    return [];
  }
}

export default { detectClusters };