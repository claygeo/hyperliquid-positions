import { createClient } from '@/lib/supabase/client';
import type { WalletFilter } from '@hyperliquid-tracker/shared';

export interface Wallet {
  address: string;
  first_seen: string;
  total_trades: number;
  total_volume: number;
  win_rate: number | null;
  entry_score: number | null;
  overall_score: number | null;
  last_trade_at: string | null;
  is_active: boolean;
}

export async function getWallets(filter: Partial<WalletFilter> = {}): Promise<Wallet[]> {
  const supabase = createClient();

  let query = supabase
    .from('wallets')
    .select('*')
    .eq('is_active', true);

  if (filter.minScore !== undefined) {
    query = query.gte('overall_score', filter.minScore);
  }
  if (filter.minTrades !== undefined) {
    query = query.gte('total_trades', filter.minTrades);
  }
  if (filter.minVolume !== undefined) {
    query = query.gte('total_volume', filter.minVolume);
  }

  const sortField = filter.sortBy || 'overall_score';
  const sortOrder = filter.sortOrder || 'desc';
  query = query.order(sortField, { ascending: sortOrder === 'asc', nullsFirst: false });

  const limit = filter.limit || 100;
  const offset = filter.offset || 0;
  query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

export async function getWallet(address: string): Promise<Wallet | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('address', address)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function searchWallets(query: string): Promise<Wallet[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .ilike('address', `%${query}%`)
    .limit(10);

  if (error) throw error;
  return data || [];
}

export async function getTopWallets(limit = 10): Promise<Wallet[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .not('overall_score', 'is', null)
    .order('overall_score', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}
