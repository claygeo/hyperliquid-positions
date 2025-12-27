// Leaderboard Fetcher - Get top traders from Hyperliquid leaderboard

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';

const logger = createLogger('collector:leaderboard');

// Correct leaderboard URL
const LEADERBOARD_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const FETCH_INTERVAL = 60 * 60 * 1000; // Refresh leaderboard every hour

let fetchInterval: NodeJS.Timeout | null = null;

interface LeaderboardEntry {
  ethAddress: string;
  accountValue: string;
  pnl: string;
  roi: string;
  displayName?: string;
}

/**
 * Fetch leaderboard from Hyperliquid stats API
 */
async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const response = await fetch(LEADERBOARD_URL, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      logger.error(`Leaderboard API error: ${response.status}`);
      return [];
    }

    const data = await response.json() as any;
    
    // The response structure may vary - log it to understand
    logger.debug('Leaderboard response type:', typeof data);
    
    // Handle different response formats
    if (Array.isArray(data)) {
      return data;
    } else if (data?.leaderboardRows) {
      return data.leaderboardRows;
    } else if (data?.data) {
      return data.data;
    }
    
    logger.warn('Unknown leaderboard format, keys:', Object.keys(data));
    return [];
  } catch (error) {
    logger.error('Failed to fetch leaderboard', error);
    return [];
  }
}

/**
 * Save leaderboard wallets to database
 */
async function saveLeaderboardWallets(entries: LeaderboardEntry[]): Promise<number> {
  if (entries.length === 0) return 0;

  let saved = 0;

  for (let i = 0; i < Math.min(entries.length, 100); i++) {
    const entry = entries[i];
    
    // Handle different field names
    const address = entry.ethAddress || (entry as any).address || (entry as any).wallet;
    if (!address) continue;
    
    try {
      const { error } = await db.client
        .from('leaderboard_wallets')
        .upsert({
          address: address.toLowerCase(),
          rank: i + 1,
          pnl: parseFloat(entry.pnl || '0') || 0,
          roi: parseFloat(entry.roi || '0') || 0,
          account_value: parseFloat(entry.accountValue || '0') || 0,
          time_window: 'allTime',
          last_updated: new Date().toISOString(),
        }, { onConflict: 'address' });

      if (!error) saved++;
    } catch (err) {
      logger.error(`Failed to save wallet ${address}`, err);
    }
  }

  return saved;
}

/**
 * Get tracked leaderboard wallet addresses
 */
export async function getLeaderboardWallets(limit: number = 100): Promise<string[]> {
  const { data, error } = await db.client
    .from('leaderboard_wallets')
    .select('address')
    .order('rank', { ascending: true })
    .limit(limit);

  if (error) {
    logger.error('Failed to get leaderboard wallets', error);
    return [];
  }

  return data?.map((w: { address: string }) => w.address) || [];
}

/**
 * Refresh leaderboard data
 */
export async function refreshLeaderboard(): Promise<void> {
  logger.info('Refreshing leaderboard...');

  const entries = await fetchLeaderboard();
  
  if (entries.length > 0) {
    const saved = await saveLeaderboardWallets(entries);
    logger.info(`Saved ${saved} wallets from leaderboard`);
  } else {
    logger.warn('No leaderboard entries received');
  }

  const totalWallets = await getLeaderboardWallets(200);
  logger.info(`Total tracked leaderboard wallets: ${totalWallets.length}`);
}

/**
 * Start periodic leaderboard refresh
 */
export async function startLeaderboardFetcher(): Promise<void> {
  // Initial fetch
  await refreshLeaderboard();

  // Start periodic refresh
  fetchInterval = setInterval(() => {
    refreshLeaderboard().catch(err => {
      logger.error('Leaderboard refresh failed', err);
    });
  }, FETCH_INTERVAL);

  logger.info('Leaderboard fetcher started');
}

/**
 * Stop leaderboard fetcher
 */
export async function stopLeaderboardFetcher(): Promise<void> {
  if (fetchInterval) {
    clearInterval(fetchInterval);
    fetchInterval = null;
  }
  logger.info('Leaderboard fetcher stopped');
}

export default {
  refreshLeaderboard,
  getLeaderboardWallets,
  startLeaderboardFetcher,
  stopLeaderboardFetcher,
};