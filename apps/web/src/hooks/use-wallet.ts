'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Wallet {
  address: string;
  first_seen: string;
  total_trades: number;
  total_volume: number;
  win_rate: number | null;
  entry_score: number | null;
  risk_adjusted_return: number | null;
  avg_hold_minutes: number | null;
  funding_efficiency: number | null;
  overall_score: number | null;
  last_trade_at: string | null;
  is_active: boolean;
  cluster_id: string | null;
  metadata: Record<string, unknown> | null;
}

interface Position {
  id: number;
  wallet: string;
  coin: string;
  size: number;
  entry_price: number;
  leverage: number;
  leverage_type: 'cross' | 'isolated';
  unrealized_pnl: number;
  liquidation_price: number | null;
  margin_used: number;
  updated_at: string;
}

interface Trade {
  id: number;
  wallet: string;
  coin: string;
  side: 'B' | 'A';
  size: number;
  price: number;
  timestamp: string;
  closed_pnl: number | null;
  entry_score: number | null;
}

interface UseWalletResult {
  wallet: Wallet | null;
  positions: Position[];
  trades: Trade[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useWallet(address: string): UseWalletResult {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    if (!address) return;

    try {
      setError(null);
      const supabase = createClient();

      // Fetch wallet data
      const { data: walletData, error: walletError } = await supabase
        .from('wallets')
        .select('*')
        .eq('address', address)
        .single();

      if (walletError && walletError.code !== 'PGRST116') {
        throw walletError;
      }
      setWallet(walletData);

      // Fetch positions
      const { data: positionsData, error: positionsError } = await supabase
        .from('positions')
        .select('*')
        .eq('wallet', address)
        .neq('size', 0)
        .order('margin_used', { ascending: false });

      if (positionsError) throw positionsError;
      setPositions(positionsData || []);

      // Fetch recent trades
      const { data: tradesData, error: tradesError } = await supabase
        .from('trades')
        .select('*')
        .eq('wallet', address)
        .order('timestamp', { ascending: false })
        .limit(100);

      if (tradesError) throw tradesError;
      setTrades(tradesData || []);

    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch wallet data'));
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Set up real-time subscription for positions
  useEffect(() => {
    if (!address) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`wallet:${address}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'positions',
          filter: `wallet=eq.${address}`,
        },
        () => {
          // Refetch positions on any change
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [address, fetchData]);

  return {
    wallet,
    positions,
    trades,
    isLoading,
    error,
    refetch: fetchData,
  };
}
