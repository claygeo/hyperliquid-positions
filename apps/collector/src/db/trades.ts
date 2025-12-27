// Trade database operations

import type { DBTrade, DBTradeInsert } from '@hyperliquid-tracker/shared';
import { db } from './client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('db:trades');

export async function insertTrade(trade: DBTradeInsert): Promise<DBTrade> {
  const { data, error } = await db.client
    .from('trades')
    .insert(trade)
    .select()
    .single();
  
  if (error) {
    logger.error('Failed to insert trade', error);
    throw error;
  }
  
  return data;
}

export async function bulkInsertTrades(trades: DBTradeInsert[]): Promise<void> {
  if (trades.length === 0) return;
  
  // Insert in batches to avoid payload limits
  const batchSize = 500;
  for (let i = 0; i < trades.length; i += batchSize) {
    const batch = trades.slice(i, i + batchSize);
    const { error } = await db.client.from('trades').insert(batch);
    
    if (error) {
      logger.error('Failed to bulk insert trades', error);
      throw error;
    }
  }
  
  logger.debug(`Inserted ${trades.length} trades`);
}

export async function getTradesByWallet(
  wallet: string,
  limit = 1000
): Promise<DBTrade[]> {
  const { data, error } = await db.client
    .from('trades')
    .select('*')
    .eq('wallet', wallet)
    .order('timestamp', { ascending: false })
    .limit(limit);
  
  if (error) {
    logger.error('Failed to get trades by wallet', error);
    throw error;
  }
  
  return data || [];
}

export async function getTradesForScoring(
  wallet: string,
  limit = 500
): Promise<DBTrade[]> {
  const { data, error } = await db.client
    .from('trades')
    .select('*')
    .eq('wallet', wallet)
    .not('closed_pnl', 'is', null)
    .order('timestamp', { ascending: false })
    .limit(limit);
  
  if (error) {
    logger.error('Failed to get trades for scoring', error);
    throw error;
  }
  
  return data || [];
}

export async function getTradesNeedingPriceBackfill(limit = 500): Promise<DBTrade[]> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  
  const { data, error } = await db.client
    .from('trades')
    .select('*')
    .lt('timestamp', fiveMinutesAgo)
    .is('price_5m_later', null)
    .order('timestamp', { ascending: true })
    .limit(limit);
  
  if (error) {
    logger.error('Failed to get trades needing backfill', error);
    throw error;
  }
  
  return data || [];
}

export async function updateTradeEntryScores(
  updates: { id: number; price_5m_later?: number; price_1h_later?: number; price_4h_later?: number; entry_score?: number }[]
): Promise<void> {
  for (const update of updates) {
    const { id, ...data } = update;
    const { error } = await db.client
      .from('trades')
      .update(data)
      .eq('id', id);
    
    if (error) {
      logger.error('Failed to update trade entry scores', error);
    }
  }
  
  logger.debug(`Updated entry scores for ${updates.length} trades`);
}

export async function getRecentTrades(
  since: Date,
  limit = 10000
): Promise<DBTrade[]> {
  const { data, error } = await db.client
    .from('trades')
    .select('*')
    .gte('timestamp', since.toISOString())
    .order('timestamp', { ascending: false })
    .limit(limit);
  
  if (error) {
    logger.error('Failed to get recent trades', error);
    throw error;
  }
  
  return data || [];
}

export async function deleteOldTrades(olderThan: Date): Promise<number> {
  const { data, error } = await db.client
    .from('trades')
    .delete()
    .lt('timestamp', olderThan.toISOString())
    .select('id');
  
  if (error) {
    logger.error('Failed to delete old trades', error);
    throw error;
  }
  
  const count = data?.length || 0;
  logger.info(`Deleted ${count} old trades`);
  return count;
}
