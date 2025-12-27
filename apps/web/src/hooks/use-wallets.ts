'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { WalletFilter, WalletSortField } from '@hyperliquid-tracker/shared';

interface Wallet {
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

interface UseWalletsOptions {
  initialFilter?: Partial<WalletFilter>;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function useWallets(options: UseWalletsOptions = {}) {
  const {
    initialFilter = {},
    autoRefresh = false,
    refreshInterval = 30000,
  } = options;

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [filter, setFilter] = useState<Partial<WalletFilter>>(initialFilter);

  const fetchWallets = useCallback(async () => {
    try {
      setError(null);
      const supabase = createClient();

      let query = supabase
        .from('wallets')
        .select('*')
        .eq('is_active', true);

      // Apply filters
      if (filter.minScore !== undefined) {
        query = query.gte('overall_score', filter.minScore);
      }
      if (filter.minTrades !== undefined) {
        query = query.gte('total_trades', filter.minTrades);
      }
      if (filter.minVolume !== undefined) {
        query = query.gte('total_volume', filter.minVolume);
      }
      if (filter.minWinRate !== undefined) {
        query = query.gte('win_rate', filter.minWinRate);
      }

      // Apply sorting
      const sortField = filter.sortBy || 'overall_score';
      const sortOrder = filter.sortOrder || 'desc';
      query = query.order(sortField, { ascending: sortOrder === 'asc', nullsFirst: false });

      // Apply pagination
      const limit = filter.limit || 100;
      const offset = filter.offset || 0;
      query = query.range(offset, offset + limit - 1);

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setWallets(data || []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch wallets'));
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(fetchWallets, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchWallets]);

  const updateFilter = useCallback((newFilter: Partial<WalletFilter>) => {
    setFilter(prev => ({ ...prev, ...newFilter }));
  }, []);

  const resetFilter = useCallback(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  return {
    wallets,
    isLoading,
    error,
    filter,
    updateFilter,
    resetFilter,
    refetch: fetchWallets,
  };
}
