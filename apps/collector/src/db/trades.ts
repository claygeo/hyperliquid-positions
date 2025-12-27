// Database operations for trades

import supabase from './client.js';
import { createLogger } from '../utils/logger.js';
import type { DBTrade, DBTradeInsert } from '@hyperliquid-tracker/shared';

const logger = createLogger('db:trades');

/**
 * Bulk insert trades (ignore duplicates)
 */
export async function bulkInsertTrades(trades: DBTradeInsert[]): Promise<number> {
  if (trades.length === 0) return 0;

  try {
    const { data, error } = await supabase
      .from('trades')
      .upsert(trades, { 
        onConflict: 'wallet,tx_hash,oid',
        ignoreDuplicates: true 
      })
      .select('id');

    if (error) {
      if (error.code === '23505') {
        logger.debug(`Skipped ${trades.length} duplicate trades`);
        return 0;
      }
      throw error;
    }

    return data?.length || 0;
  } catch (error) {
    logger.error('Failed to bulk insert trades', error);
    return 0;
  }
}

/**
 * Get trades for scoring a wallet
 */
export async function getTradesForScoring(wallet: string, limit: number = 1000): Promise<DBTrade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('wallet', wallet)
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error(`Failed to get trades for ${wallet}`, error);
    return [];
  }

  return data || [];
}

/**
 * Get recent trades (for wallet discovery)
 */
export async function getRecentTrades(limit: number = 1000): Promise<DBTrade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('Failed to get recent trades', error);
    return [];
  }

  return data || [];
}

/**
 * Get recent trades for a coin
 */
export async function getRecentTradesForCoin(coin: string, limit: number = 100): Promise<DBTrade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('coin', coin)
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error(`Failed to get trades for ${coin}`, error);
    return [];
  }

  return data || [];
}

/**
 * Get trades needing price backfill
 */
export async function getTradesNeedingPriceBackfill(limit: number = 100): Promise<DBTrade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .is('entry_score', null)
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('Failed to get trades needing backfill', error);
    return [];
  }

  return data || [];
}

/**
 * Update trade entry score
 */
export async function updateTradeEntryScore(
  tradeId: number,
  entryScore: number,
  priceAtEntry: number,
  price5mAfter: number | null,
  price1hAfter: number | null
): Promise<void> {
  const { error } = await supabase
    .from('trades')
    .update({
      entry_score: entryScore,
      price_at_entry: priceAtEntry,
      price_5m_after: price5mAfter,
      price_1h_after: price1hAfter,
    })
    .eq('id', tradeId);

  if (error) {
    logger.error(`Failed to update entry score for trade ${tradeId}`, error);
  }
}

/**
 * Bulk update trade entry scores
 */
export async function updateTradeEntryScores(
  updates: Array<{
    id: number;
    entry_score: number;
    price_at_entry: number;
    price_5m_after: number | null;
    price_1h_after: number | null;
  }>
): Promise<void> {
  for (const update of updates) {
    await updateTradeEntryScore(
      update.id,
      update.entry_score,
      update.price_at_entry,
      update.price_5m_after,
      update.price_1h_after
    );
  }
}

/**
 * Delete old trades
 */
export async function deleteOldTrades(olderThanDays: number = 30): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const { data, error } = await supabase
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

/**
 * Get trade count for wallet
 */
export async function getTradeCountForWallet(wallet: string): Promise<number> {
  const { count, error } = await supabase
    .from('trades')
    .select('*', { count: 'exact', head: true })
    .eq('wallet', wallet);

  if (error) {
    logger.error(`Failed to get trade count for ${wallet}`, error);
    return 0;
  }

  return count || 0;
}

export default {
  bulkInsertTrades,
  getTradesForScoring,
  getRecentTrades,
  getRecentTradesForCoin,
  getTradesNeedingPriceBackfill,
  updateTradeEntryScore,
  updateTradeEntryScores,
  deleteOldTrades,
  getTradeCountForWallet,
};