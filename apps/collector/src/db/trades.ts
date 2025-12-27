// Database operations for trades

import db from './client.js';
import { createLogger } from '../utils/logger.js';
import type { DBTrade, DBTradeInsert } from '@hyperliquid-tracker/shared';

const logger = createLogger('db:trades');

/**
 * Bulk insert trades (ignore duplicates)
 */
export async function bulkInsertTrades(trades: DBTradeInsert[]): Promise<number> {
  if (trades.length === 0) return 0;

  try {
    const validTrades = trades.filter(t => t.wallet && t.coin && t.tx_hash);
    
    if (validTrades.length === 0) return 0;

    const { data, error } = await db.client
      .from('trades')
      .upsert(validTrades, { 
        onConflict: 'wallet,tx_hash,oid',
        ignoreDuplicates: true 
      })
      .select('id');

    if (error) {
      // Silently handle duplicates and FK violations
      if (error.code === '23505' || error.code === '23503') {
        return 0;
      }
      logger.error('Failed to bulk insert trades', error);
      return 0;
    }

    return data?.length || 0;
  } catch (error) {
    logger.error('Failed to bulk insert trades', error);
    return 0;
  }
}

/**
 * Get trades for a wallet
 */
export async function getTradesForWallet(wallet: string, limit: number = 100): Promise<DBTrade[]> {
  const { data, error } = await db.client
    .from('trades')
    .select('*')
    .eq('wallet', wallet.toLowerCase())
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error(`Failed to get trades for ${wallet}`, error);
    return [];
  }

  return (data || []) as DBTrade[];
}

/**
 * Get recent trades
 */
export async function getRecentTrades(limit: number = 100): Promise<DBTrade[]> {
  const { data, error } = await db.client
    .from('trades')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('Failed to get recent trades', error);
    return [];
  }

  return (data || []) as DBTrade[];
}

/**
 * Get trades with profit/loss
 */
export async function getClosedTrades(wallet: string, limit: number = 100): Promise<DBTrade[]> {
  const { data, error } = await db.client
    .from('trades')
    .select('*')
    .eq('wallet', wallet.toLowerCase())
    .neq('closed_pnl', 0)
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error(`Failed to get closed trades for ${wallet}`, error);
    return [];
  }

  return (data || []) as DBTrade[];
}

/**
 * Delete old trades
 */
export async function deleteOldTrades(olderThanDays: number = 30): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const { data, error } = await db.client
    .from('trades')
    .delete()
    .lt('timestamp', cutoffDate.toISOString())
    .select('id');

  if (error) {
    logger.error('Failed to delete old trades', error);
    return 0;
  }

  return data?.length || 0;
}

export default {
  bulkInsertTrades,
  getTradesForWallet,
  getRecentTrades,
  getClosedTrades,
  deleteOldTrades,
};