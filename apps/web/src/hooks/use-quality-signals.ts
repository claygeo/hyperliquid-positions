'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

// Types for quality signals
export interface Trader {
  address: string;
  quality_tier: 'elite' | 'good';
  pnl_7d: number;
  win_rate: number;
  entry_price: number;
  position_value: number;
}

export interface QualitySignal {
  id: number;
  coin: string;
  direction: 'long' | 'short';
  elite_count: number;
  good_count: number;
  total_traders: number;
  combined_pnl_7d: number;
  combined_account_value: number;
  avg_win_rate: number;
  total_position_value: number;
  avg_entry_price: number;
  avg_leverage: number;
  traders: Trader[];
  signal_strength: 'strong' | 'medium';
  is_active: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface PositionHistoryEvent {
  id: number;
  coin: string;
  direction: string;
  address: string;
  event_type: 'opened' | 'closed';
  entry_price: number;
  exit_price: number | null;
  position_value: number;
  size: number;
  leverage: number;
  quality_tier: string;
  pnl_7d: number;
  win_rate: number;
  pnl_realized: number | null;
  hold_duration_hours: number | null;
  created_at: string;
}

export interface SignalHistory {
  opened: PositionHistoryEvent[];
  closed: PositionHistoryEvent[];
}

export interface QualityStats {
  elite: number;
  good: number;
  tracked: number;
}

export type SignalFilter = 'all' | 'strong' | 'long' | 'short';

export function useQualitySignals() {
  const [signals, setSignals] = useState<QualitySignal[]>([]);
  const [stats, setStats] = useState<QualityStats>({ elite: 0, good: 0, tracked: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<SignalFilter>('all');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchSignals = useCallback(async () => {
    const supabase = createClient();

    // Fetch active signals
    const { data: signalsData, error: signalsError } = await supabase
      .from('quality_signals')
      .select('*')
      .eq('is_active', true)
      .order('elite_count', { ascending: false })
      .order('good_count', { ascending: false });

    if (signalsError) {
      console.error('Error fetching signals:', signalsError);
    } else {
      setSignals(signalsData || []);
    }

    // Fetch quality stats
    const { data: statsData, error: statsError } = await supabase
      .from('trader_quality')
      .select('quality_tier, is_tracked');

    if (!statsError && statsData) {
      const elite = statsData.filter((t: any) => t.quality_tier === 'elite').length;
      const good = statsData.filter((t: any) => t.quality_tier === 'good').length;
      const tracked = statsData.filter((t: any) => t.is_tracked).length;
      setStats({ elite, good, tracked });
    }

    setLastUpdated(new Date());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchSignals();

    // Poll every 30 seconds
    const interval = setInterval(fetchSignals, 30000);

    // Set up real-time subscription
    const supabase = createClient();
    const channel = supabase
      .channel('quality_signals_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quality_signals' },
        () => {
          fetchSignals();
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [fetchSignals]);

  // Filter signals
  const filteredSignals = signals.filter((signal) => {
    if (filter === 'strong' && signal.signal_strength !== 'strong') return false;
    if (filter === 'long' && signal.direction !== 'long') return false;
    if (filter === 'short' && signal.direction !== 'short') return false;
    return true;
  });

  return {
    signals: filteredSignals,
    allSignals: signals,
    stats,
    isLoading,
    filter,
    setFilter,
    lastUpdated,
    refetch: fetchSignals,
  };
}

// Hook to fetch signal history (opened/closed positions)
export function useSignalHistory(coin: string, direction: string) {
  const [history, setHistory] = useState<SignalHistory>({ opened: [], closed: [] });
  const [isLoading, setIsLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!coin || !direction) return;
    
    setIsLoading(true);
    const supabase = createClient();

    // Fetch last 24 hours of history
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('signal_position_history')
      .select('*')
      .eq('coin', coin)
      .eq('direction', direction)
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching history:', error);
    } else {
      const events = data || [];
      setHistory({
        opened: events.filter((e: PositionHistoryEvent) => e.event_type === 'opened'),
        closed: events.filter((e: PositionHistoryEvent) => e.event_type === 'closed'),
      });
    }

    setIsLoading(false);
  }, [coin, direction]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { history, isLoading, refetch: fetchHistory };
}