'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Trade {
  id: number;
  wallet: string;
  coin: string;
  side: 'B' | 'A';
  size: number;
  price: number;
  timestamp: string;
  tx_hash: string;
  is_taker: boolean;
  fee: number;
  closed_pnl: number | null;
  entry_score: number | null;
}

interface UseTradesOptions {
  wallet?: string;
  coin?: string;
  limit?: number;
}

export function useTrades(options: UseTradesOptions = {}) {
  const { wallet, coin, limit = 100 } = options;

  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const fetchTrades = useCallback(async (offset = 0) => {
    try {
      setError(null);
      const supabase = createClient();

      let query = supabase
        .from('trades')
        .select('*')
        .order('timestamp', { ascending: false })
        .range(offset, offset + limit - 1);

      if (wallet) {
        query = query.eq('wallet', wallet);
      }
      if (coin) {
        query = query.eq('coin', coin);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      if (offset === 0) {
        setTrades(data || []);
      } else {
        setTrades(prev => [...prev, ...(data || [])]);
      }

      setHasMore((data?.length || 0) === limit);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch trades'));
    } finally {
      setIsLoading(false);
    }
  }, [wallet, coin, limit]);

  useEffect(() => {
    fetchTrades(0);
  }, [fetchTrades]);

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      fetchTrades(trades.length);
    }
  }, [fetchTrades, isLoading, hasMore, trades.length]);

  return {
    trades,
    isLoading,
    error,
    hasMore,
    loadMore,
    refetch: () => fetchTrades(0),
  };
}
