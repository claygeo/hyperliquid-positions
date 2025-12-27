// Leaderboard Fetcher - Get top traders from Hyperliquid leaderboard

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';

const logger = createLogger('collector:leaderboard');

const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';
const FETCH_INTERVAL = 60 * 60 * 1000; // Refresh leaderboard every hour

let fetchInterval: NodeJS.Timeout | null = null;

interface LeaderboardEntry {
  ethAddress: string;
  accountValue: string;
  pnl: string;
  roi: string;
  displayName?: string;
}

interface LeaderboardResponse {
  leaderboardRows: LeaderboardEntry[];
}

/**
 * Fetch leaderboard from Hyperliquid API
 */
async function fetchLeaderboard(timeWindow: string = 'month'): Promise<LeaderboardEntry[]> {
  try {
    const response = await fetch(HYPERLIQUID_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'leaderboard',
        timeWindow: timeWindow,
      }),
    });

    if (!response.ok) {
      logger.error(`Leaderboard API error: ${response.status}`);
      return [];
    }

    const data = await response.json() as LeaderboardResponse;
    return data?.leaderboardRows || [];
  } catch (error) {
    logger.error('Failed to fetch leaderboard', error);
    return [];
  }
}

/**
 * Save leaderboard wallets to database
 */
async function saveLeaderboardWallets(entries: LeaderboardEntry[], timeWindow: string): Promise<number> {
  if (entries.length === 0) return 0;

  let saved = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    
    try {
      const { error } = await db.client
        .from('leaderboard_wallets')
        .upsert({
          address: entry.ethAddress.toLowerCase(),
          rank: i + 1,
          pnl: parseFloat(entry.pnl) || 0,
          roi: parseFloat(entry.roi) || 0,
          account_value: parseFloat(entry.accountValue) || 0,
          time_window: timeWindow,
          last_updated: new Date().toISOString(),
        }, { onConflict: 'address' });

      if (!error) saved++;
    } catch (err) {
      logger.error(`Failed to save wallet ${entry.ethAddress}`, err);
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

  // Fetch from multiple time windows for diversity
  const windows = ['month', 'week'];
  
  for (const window of windows) {
    const entries = await fetchLeaderboard(window);
    
    if (entries.length > 0) {
      // Take top 50 from each window
      const topEntries = entries.slice(0, 50);
      const saved = await saveLeaderboardWallets(topEntries, window);
      logger.info(`Saved ${saved} wallets from ${window} leaderboard`);
    }
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