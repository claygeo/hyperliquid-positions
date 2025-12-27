// Signal database operations

import type { DBSignal, DBSignalInsert, SignalType } from '@hyperliquid-tracker/shared';
import { db } from './client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('db:signals');

export async function insertSignal(signal: DBSignalInsert): Promise<DBSignal> {
  const { data, error } = await db.client
    .from('signals')
    .insert(signal)
    .select()
    .single();
  
  if (error) {
    logger.error('Failed to insert signal', error);
    throw error;
  }
  
  logger.info('Created signal', { type: signal.signal_type, coin: signal.coin });
  return data;
}

export async function getActiveSignals(limit = 100): Promise<DBSignal[]> {
  const now = new Date().toISOString();
  
  const { data, error } = await db.client
    .from('signals')
    .select('*')
    .eq('is_active', true)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) {
    logger.error('Failed to get active signals', error);
    throw error;
  }
  
  return data || [];
}

export async function getSignalsByType(
  type: SignalType,
  limit = 50
): Promise<DBSignal[]> {
  const { data, error } = await db.client
    .from('signals')
    .select('*')
    .eq('signal_type', type)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) {
    logger.error('Failed to get signals by type', error);
    throw error;
  }
  
  return data || [];
}

export async function getSignalsByWallet(
  wallet: string,
  limit = 50
): Promise<DBSignal[]> {
  const { data, error } = await db.client
    .from('signals')
    .select('*')
    .contains('wallets', [wallet])
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) {
    logger.error('Failed to get signals by wallet', error);
    throw error;
  }
  
  return data || [];
}

export async function deactivateSignal(id: number): Promise<void> {
  const { error } = await db.client
    .from('signals')
    .update({ is_active: false })
    .eq('id', id);
  
  if (error) {
    logger.error('Failed to deactivate signal', error);
    throw error;
  }
}

export async function deactivateExpiredSignals(): Promise<number> {
  const now = new Date().toISOString();
  
  const { data, error } = await db.client
    .from('signals')
    .update({ is_active: false })
    .eq('is_active', true)
    .lt('expires_at', now)
    .select('id');
  
  if (error) {
    logger.error('Failed to deactivate expired signals', error);
    throw error;
  }
  
  const count = data?.length || 0;
  if (count > 0) {
    logger.info(`Deactivated ${count} expired signals`);
  }
  return count;
}

export async function deleteOldSignals(olderThan: Date): Promise<number> {
  const { data, error } = await db.client
    .from('signals')
    .delete()
    .eq('is_active', false)
    .lt('created_at', olderThan.toISOString())
    .select('id');
  
  if (error) {
    logger.error('Failed to delete old signals', error);
    throw error;
  }
  
  const count = data?.length || 0;
  if (count > 0) {
    logger.info(`Deleted ${count} old signals`);
  }
  return count;
}
