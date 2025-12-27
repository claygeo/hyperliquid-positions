// Wallet fills collector - fetches historical fills for wallets

import { createLogger } from '../utils/logger.js';
import { getTrackedWallets } from '../db/wallets.js';

const logger = createLogger('collector:wallet-fills');

const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';

interface Fill {
  coin: string;
  px: string;
  sz: string;
  side: string;
  time: number;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
}

/**
 * Fetch fills for a wallet
 */
export async function fetchWalletFills(address: string): Promise<Fill[]> {
  try {
    const response = await fetch(HYPERLIQUID_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'userFills',
        user: address,
      }),
    });

    if (!response.ok) return [];

    const data = await response.json() as Fill[] | null;
    return Array.isArray(data) ? data : [];
  } catch (error) {
    logger.error(`Failed to fetch fills for ${address}`, error);
    return [];
  }
}

/**
 * Sync fills for all tracked wallets
 */
export async function syncWalletFills(): Promise<void> {
  const wallets = await getTrackedWallets();

  logger.info(`Syncing fills for ${wallets.length} wallets`);

  for (const wallet of wallets) {
    try {
      const fills = await fetchWalletFills(wallet.address);
      logger.debug(`${wallet.address.slice(0, 10)}... has ${fills.length} fills`);

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      logger.error(`Failed to sync fills for ${wallet.address}`, error);
    }
  }
}

export default {
  fetchWalletFills,
  syncWalletFills,
};