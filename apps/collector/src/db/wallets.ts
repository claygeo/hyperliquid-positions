// Database operations for wallets

import db from './client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('db:wallets');

export interface WalletRecord {
  address: string;
  label?: string;
  score: number;
  score_breakdown: Record<string, number>;
  win_rate: number;
  win_count: number;
  loss_count: number;
  total_trades: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  realized_pnl: number;
  total_pnl: number;
  largest_win: number;
  largest_loss: number;
  is_tracked: boolean;
  first_seen_at: string;
  last_trade_at: string | null;
  last_updated_at: string;
}

/**
 * Get top wallets by score
 */
export async function getTopWallets(limit: number = 50, minTrades: number = 5): Promise<WalletRecord[]> {
  const { data, error } = await db.client
    .from('wallets')
    .select('*')
    .gte('total_trades', minTrades)
    .gt('score', 0)
    .order('score', { ascending: false })
    .order('realized_pnl', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('Failed to get top wallets', error);
    return [];
  }

  return data || [];
}

/**
 * Get wallets for scoring
 */
export async function getWalletsForScoring(minTrades: number = 0): Promise<WalletRecord[]> {
  const { data, error } = await db.client
    .from('wallets')
    .select('*')
    .gte('total_trades', minTrades)
    .eq('is_tracked', true);

  if (error) {
    logger.error('Failed to get wallets for scoring', error);
    return [];
  }

  return data || [];
}

/**
 * Get tracked wallet addresses
 */
export async function getTrackedWallets(): Promise<WalletRecord[]> {
  const { data, error } = await db.client
    .from('wallets')
    .select('*')
    .eq('is_tracked', true)
    .gt('score', 50)
    .order('score', { ascending: false })
    .limit(100);

  if (error) {
    logger.error('Failed to get tracked wallets', error);
    return [];
  }

  return data || [];
}

/**
 * Get wallet addresses only
 */
export async function getWalletAddresses(): Promise<string[]> {
  const { data, error } = await db.client
    .from('wallets')
    .select('address')
    .eq('is_tracked', true)
    .gt('score', 40);

  if (error) {
    logger.error('Failed to get wallet addresses', error);
    return [];
  }

  return data?.map(w => w.address) || [];
}

/**
 * Get wallet by address
 */
export async function getWalletByAddress(address: string): Promise<WalletRecord | null> {
  const { data, error } = await db.client
    .from('wallets')
    .select('*')
    .eq('address', address.toLowerCase())
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    logger.error(`Failed to get wallet ${address}`, error);
    return null;
  }

  return data;
}

/**
 * Upsert wallet (used by alpha detector)
 */
export async function upsertWallet(wallet: Partial<WalletRecord> & { address: string }): Promise<void> {
  const { error } = await db.client
    .from('wallets')
    .upsert({
      ...wallet,
      address: wallet.address.toLowerCase(),
    }, { onConflict: 'address' });

  if (error) {
    logger.error(`Failed to upsert wallet ${wallet.address}`, error);
  }
}

/**
 * Get fresh wallets with good performance (for discovery)
 */
export async function getFreshAlphaWallets(daysOld: number = 7, minScore: number = 50): Promise<WalletRecord[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  const { data, error } = await db.client
    .from('wallets')
    .select('*')
    .gte('first_seen_at', cutoff.toISOString())
    .gte('score', minScore)
    .gt('realized_pnl', 0)
    .gte('total_trades', 3)
    .order('score', { ascending: false })
    .limit(20);

  if (error) {
    logger.error('Failed to get fresh alpha wallets', error);
    return [];
  }

  return data || [];
}

export default {
  getTopWallets,
  getWalletsForScoring,
  getTrackedWallets,
  getWalletAddresses,
  getWalletByAddress,
  upsertWallet,
  getFreshAlphaWallets,
};