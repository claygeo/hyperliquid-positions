// Position poller - polls positions for tracked wallets

import { createLogger } from '../utils/logger.js';
import { getTrackedWallets } from '../db/wallets.js';

const logger = createLogger('collector:position-poller');

const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';
const POLL_INTERVAL = 30000; // 30 seconds

let pollInterval: NodeJS.Timeout | null = null;
let isRunning = false;

interface ClearinghouseResponse {
  assetPositions?: Array<{
    position: {
      coin: string;
      szi: string;
      entryPx: string;
      leverage: { type: string; value: number };
      unrealizedPnl: string;
      liquidationPx: string | null;
      marginUsed: string;
    };
  }>;
}

/**
 * Fetch positions for a wallet
 */
async function fetchPositions(address: string): Promise<any[]> {
  try {
    const response = await fetch(HYPERLIQUID_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clearinghouseState',
        user: address,
      }),
    });

    if (!response.ok) return [];

    const data: ClearinghouseResponse = await response.json() as ClearinghouseResponse;
    return data?.assetPositions || [];
  } catch (error) {
    logger.error(`Failed to fetch positions for ${address}`, error);
    return [];
  }
}

/**
 * Poll positions for all tracked wallets
 */
async function pollPositions(): Promise<void> {
  try {
    const wallets = await getTrackedWallets();

    if (wallets.length === 0) {
      logger.debug('No tracked wallets to poll');
      return;
    }

    logger.debug(`Polling positions for ${wallets.length} wallets`);

    for (const wallet of wallets) {
      const positions = await fetchPositions(wallet.address);

      if (positions.length > 0) {
        logger.debug(`${wallet.address.slice(0, 10)}... has ${positions.length} positions`);
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (error) {
    logger.error('Position polling failed', error);
  }
}

/**
 * Start position polling
 */
export async function startPositionPoller(): Promise<void> {
  isRunning = true;

  // Initial poll
  await pollPositions();

  // Start interval
  pollInterval = setInterval(pollPositions, POLL_INTERVAL);

  logger.info('Position poller started');
}

/**
 * Stop position polling
 */
export async function stopPositionPoller(): Promise<void> {
  isRunning = false;

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  logger.info('Position poller stopped');
}

/**
 * Get poller instance
 */
export function getPositionPoller() {
  return {
    start: startPositionPoller,
    stop: stopPositionPoller,
  };
}

export default {
  startPositionPoller,
  stopPositionPoller,
  getPositionPoller,
};