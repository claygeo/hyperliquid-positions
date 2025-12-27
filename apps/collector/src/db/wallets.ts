// Wallet database operations

import type { DBWallet, DBWalletInsert, DBWalletUpdate } from '@hyperliquid-tracker/shared';
import { db } from './client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('db:wallets');

export async function getWallet(address: string): Promise<DBWallet | null> {
  const { data, error } = await db.client
    .from('wallets')
    .select('*')
    .eq('address', address)
    .single();
  
  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to get wallet', error);
    throw error;
  }
  
  return data;
}

export async function upsertWallet(wallet: DBWalletInsert): Promise<DBWallet> {
  const { data, error } = await db.client
    .from('wallets')
    .upsert(wallet, { onConflict: 'address' })
    .select()
    .single();
  
  if (error) {
    logger.error('Failed to upsert wallet', error);
    throw error;
  }
  
  return data;
}

export async function updateWallet(
  address: string,
  update: DBWalletUpdate
): Promise<DBWallet | null> {
  const { data, error } = await db.client
    .from('wallets')
    .update({ ...update, last_updated: new Date().toISOString() })
    .eq('address', address)
    .select()
    .single();
  
  if (error) {
    logger.error('Failed to update wallet', error);
    throw error;
  }
  
  return data;
}

export async function getActiveWallets(limit = 1000): Promise<DBWallet[]> {
  const { data, error } = await db.client
    .from('wallets')
    .select('*')
    .eq('is_active', true)
    .order('overall_score', { ascending: false, nullsFirst: false })
    .limit(limit);
  
  if (error) {
    logger.error('Failed to get active wallets', error);
    throw error;
  }
  
  return data || [];
}

export async function getWalletsForScoring(
  minTrades: number,
  limit = 500
): Promise<DBWallet[]> {
  const { data, error } = await db.client
    .from('wallets')
    .select('*')
    .gte('total_trades', minTrades)
    .order('last_updated', { ascending: true })
    .limit(limit);
  
  if (error) {
    logger.error('Failed to get wallets for scoring', error);
    throw error;
  }
  
  return data || [];
}

export async function getWalletAddresses(): Promise<string[]> {
  const { data, error } = await db.client
    .from('wallets')
    .select('address')
    .eq('is_active', true);
  
  if (error) {
    logger.error('Failed to get wallet addresses', error);
    throw error;
  }
  
  return (data || []).map(w => w.address);
}

export async function bulkUpsertWallets(wallets: DBWalletInsert[]): Promise<void> {
  if (wallets.length === 0) return;
  
  const { error } = await db.client
    .from('wallets')
    .upsert(wallets, { onConflict: 'address' });
  
  if (error) {
    logger.error('Failed to bulk upsert wallets', error);
    throw error;
  }
  
  logger.debug(`Upserted ${wallets.length} wallets`);
}

export async function setWalletInactive(address: string): Promise<void> {
  const { error } = await db.client
    .from('wallets')
    .update({ is_active: false, last_updated: new Date().toISOString() })
    .eq('address', address);
  
  if (error) {
    logger.error('Failed to set wallet inactive', error);
    throw error;
  }
}
