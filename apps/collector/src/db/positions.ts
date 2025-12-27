// Position database operations

import type { DBPosition, DBPositionUpsert } from '@hyperliquid-tracker/shared';
import { db } from './client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('db:positions');

export async function upsertPosition(position: DBPositionUpsert): Promise<DBPosition> {
  const { data, error } = await db.client
    .from('positions')
    .upsert(
      { ...position, updated_at: new Date().toISOString() },
      { onConflict: 'wallet,coin' }
    )
    .select()
    .single();
  
  if (error) {
    logger.error('Failed to upsert position', error);
    throw error;
  }
  
  return data;
}

export async function bulkUpsertPositions(positions: DBPositionUpsert[]): Promise<void> {
  if (positions.length === 0) return;
  
  const now = new Date().toISOString();
  const positionsWithTimestamp = positions.map(p => ({
    ...p,
    updated_at: now,
  }));
  
  const { error } = await db.client
    .from('positions')
    .upsert(positionsWithTimestamp, { onConflict: 'wallet,coin' });
  
  if (error) {
    logger.error('Failed to bulk upsert positions', error);
    throw error;
  }
  
  logger.debug(`Upserted ${positions.length} positions`);
}

export async function getPositionsByWallet(wallet: string): Promise<DBPosition[]> {
  const { data, error } = await db.client
    .from('positions')
    .select('*')
    .eq('wallet', wallet)
    .neq('size', 0);
  
  if (error) {
    logger.error('Failed to get positions by wallet', error);
    throw error;
  }
  
  return data || [];
}

export async function getAllOpenPositions(): Promise<DBPosition[]> {
  const { data, error } = await db.client
    .from('positions')
    .select('*')
    .neq('size', 0);
  
  if (error) {
    logger.error('Failed to get all open positions', error);
    throw error;
  }
  
  return data || [];
}

export async function getPositionsByCoin(coin: string): Promise<DBPosition[]> {
  const { data, error } = await db.client
    .from('positions')
    .select('*')
    .eq('coin', coin)
    .neq('size', 0);
  
  if (error) {
    logger.error('Failed to get positions by coin', error);
    throw error;
  }
  
  return data || [];
}

export async function deleteClosedPositions(wallet: string, openCoins: string[]): Promise<void> {
  if (openCoins.length === 0) {
    // Delete all positions for this wallet
    const { error } = await db.client
      .from('positions')
      .delete()
      .eq('wallet', wallet);
    
    if (error) {
      logger.error('Failed to delete closed positions', error);
      throw error;
    }
    return;
  }
  
  const { error } = await db.client
    .from('positions')
    .delete()
    .eq('wallet', wallet)
    .not('coin', 'in', `(${openCoins.join(',')})`);
  
  if (error) {
    logger.error('Failed to delete closed positions', error);
    throw error;
  }
}

export async function clearStalePositions(olderThan: Date): Promise<number> {
  const { data, error } = await db.client
    .from('positions')
    .delete()
    .lt('updated_at', olderThan.toISOString())
    .select('id');
  
  if (error) {
    logger.error('Failed to clear stale positions', error);
    throw error;
  }
  
  const count = data?.length || 0;
  if (count > 0) {
    logger.info(`Cleared ${count} stale positions`);
  }
  return count;
}
