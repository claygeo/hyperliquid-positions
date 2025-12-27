'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Signal {
  id: number;
  signal_type: string;
  wallets: string[];
  coin: string | null;
  direction: 'long' | 'short' | null;
  confidence: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface SignalFilters {
  types: string[];
  minConfidence: number;
}

export function useSignals() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<SignalFilters>({
    types: [],
    minConfidence: 0,
  });

  useEffect(() => {
    fetchSignals();

    // Set up real-time subscription
    const supabase = createClient();
    const channel = supabase
      .channel('signals')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'signals' },
        (payload) => {
          const newSignal = payload.new as Signal;
          setSignals((prev) => [newSignal, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function fetchSignals() {
    setIsLoading(true);
    const supabase = createClient();

    let query = supabase
      .from('signals')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(100);

    if (filters.types.length > 0) {
      query = query.in('signal_type', filters.types);
    }

    if (filters.minConfidence > 0) {
      query = query.gte('confidence', filters.minConfidence);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching signals:', error);
    } else {
      setSignals(data || []);
    }
    setIsLoading(false);
  }

  // Re-fetch when filters change
  useEffect(() => {
    fetchSignals();
  }, [filters.types.join(','), filters.minConfidence]);

  const filteredSignals = signals.filter((signal) => {
    if (filters.types.length > 0 && !filters.types.includes(signal.signal_type)) {
      return false;
    }
    if (signal.confidence < filters.minConfidence) {
      return false;
    }
    return true;
  });

  return {
    signals: filteredSignals,
    isLoading,
    filters,
    setFilters,
    refetch: fetchSignals,
  };
}
