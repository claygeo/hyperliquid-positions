'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

type EventType = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

interface UseRealtimeOptions<T> {
  table: string;
  event?: EventType;
  filter?: string;
  onInsert?: (record: T) => void;
  onUpdate?: (record: T, old: T) => void;
  onDelete?: (record: T) => void;
  onChange?: (payload: { eventType: string; new: T; old: T }) => void;
}

export function useRealtime<T extends Record<string, unknown>>({
  table,
  event = '*',
  filter,
  onInsert,
  onUpdate,
  onDelete,
  onChange,
}: UseRealtimeOptions<T>) {
  const channelRef = useRef<RealtimeChannel | null>(null);

  const subscribe = useCallback(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`${table}-changes-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event,
          schema: 'public',
          table,
          filter,
        },
        (payload) => {
          const newRecord = payload.new as T;
          const oldRecord = payload.old as T;

          // Call specific handlers
          if (payload.eventType === 'INSERT' && onInsert) {
            onInsert(newRecord);
          } else if (payload.eventType === 'UPDATE' && onUpdate) {
            onUpdate(newRecord, oldRecord);
          } else if (payload.eventType === 'DELETE' && onDelete) {
            onDelete(oldRecord);
          }

          // Call generic onChange handler
          if (onChange) {
            onChange({
              eventType: payload.eventType,
              new: newRecord,
              old: oldRecord,
            });
          }
        }
      )
      .subscribe();

    channelRef.current = channel;
    return channel;
  }, [table, event, filter, onInsert, onUpdate, onDelete, onChange]);

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      const supabase = createClient();
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  useEffect(() => {
    subscribe();
    return () => unsubscribe();
  }, [subscribe, unsubscribe]);

  return {
    unsubscribe,
    resubscribe: () => {
      unsubscribe();
      subscribe();
    },
  };
}

// Convenience hook for signals real-time updates
export function useRealtimeSignals(onSignal: (signal: unknown) => void) {
  return useRealtime({
    table: 'signals',
    event: 'INSERT',
    onInsert: onSignal,
  });
}

// Convenience hook for position real-time updates
export function useRealtimePositions(
  wallet: string,
  onUpdate: (position: unknown) => void
) {
  return useRealtime({
    table: 'positions',
    filter: `wallet=eq.${wallet}`,
    onChange: (payload) => onUpdate(payload.new),
  });
}
