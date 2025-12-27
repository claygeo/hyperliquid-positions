import { createClient } from '@/lib/supabase/client';

export interface WatchlistEntry {
  id: number;
  user_id: string;
  wallet_address: string;
  nickname: string | null;
  notes: string | null;
  added_at: string;
}

export async function getWatchlist(userId: string): Promise<WatchlistEntry[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('watchlist')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function addToWatchlist(
  userId: string,
  walletAddress: string,
  nickname?: string,
  notes?: string
): Promise<WatchlistEntry> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('watchlist')
    .insert({
      user_id: userId,
      wallet_address: walletAddress,
      nickname,
      notes,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeFromWatchlist(
  userId: string,
  walletAddress: string
): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from('watchlist')
    .delete()
    .eq('user_id', userId)
    .eq('wallet_address', walletAddress);

  if (error) throw error;
}

export async function updateWatchlistEntry(
  id: number,
  updates: { nickname?: string; notes?: string }
): Promise<WatchlistEntry> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('watchlist')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function isInWatchlist(
  userId: string,
  walletAddress: string
): Promise<boolean> {
  const supabase = createClient();

  const { count, error } = await supabase
    .from('watchlist')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('wallet_address', walletAddress);

  if (error) throw error;
  return (count || 0) > 0;
}
