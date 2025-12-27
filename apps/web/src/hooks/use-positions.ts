'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

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

interface UsePositionsOptions {
  wallet?: string;
  coin?: string;
  realtime?: boolean;
}

export function usePositions(options: UsePositionsOptions = {}) {
  const { wallet, coin, realtime = true } = options;

  const [positions, setPositions] = useState<Position[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPositions = useCallback(async () => {
    try {
      setError(null);
      const supabase = createClient();

      let query = supabase
        .from('positions')
        .select('*')
        .neq('size', 0);

      if (wallet) {
        query = query.eq('wallet', wallet);
      }
      if (coin) {
        query = query.eq('coin', coin);
      }

      query = query.order('margin_used', { ascending: false });

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setPositions(data || []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch positions'));
    } finally {
      setIsLoading(false);
    }
  }, [wallet, coin]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  // Real-time subscription
  useEffect(() => {
    if (!realtime) return;

    const supabase = createClient();
    
    let filter = 'size=neq.0';
    if (wallet) filter += `,wallet=eq.${wallet}`;
    if (coin) filter += `,coin=eq.${coin}`;

    const channel = supabase
      .channel('positions-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'positions',
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const newPosition = payload.new as Position;
            
            // Apply filters
            if (wallet && newPosition.wallet !== wallet) return;
            if (coin && newPosition.coin !== coin) return;
            
            setPositions(prev => {
              const index = prev.findIndex(
                p => p.wallet === newPosition.wallet && p.coin === newPosition.coin
              );
              
              if (newPosition.size === 0) {
                // Position closed, remove it
                return prev.filter((_, i) => i !== index);
              }
              
              if (index >= 0) {
                // Update existing
                const updated = [...prev];
                updated[index] = newPosition;
                return updated;
              } else {
                // Add new
                return [newPosition, ...prev];
              }
            });
          } else if (payload.eventType === 'DELETE') {
            const oldPosition = payload.old as Position;
            setPositions(prev => 
              prev.filter(p => !(p.wallet === oldPosition.wallet && p.coin === oldPosition.coin))
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [realtime, wallet, coin]);

  return {
    positions,
    isLoading,
    error,
    refetch: fetchPositions,
  };
}
