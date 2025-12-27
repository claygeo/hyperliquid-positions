'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Wallet {
  address: string;
  total_trades: number;
  total_volume: number;
  win_rate: number | null;
  entry_score: number | null;
  overall_score: number | null;
  last_trade_at: string | null;
}

export function useWatchlist() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [watchlistAddresses, setWatchlistAddresses] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Load watchlist from localStorage
    const saved = localStorage.getItem('watchlist');
    if (saved) {
      try {
        const addresses = JSON.parse(saved) as string[];
        setWatchlistAddresses(new Set(addresses));
        fetchWallets(addresses);
      } catch {
        setIsLoading(false);
      }
    } else {
      setIsLoading(false);
    }
  }, []);

  async function fetchWallets(addresses: string[]) {
    if (addresses.length === 0) {
      setWallets([]);
      setIsLoading(false);
      return;
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from('wallets')
      .select('address, total_trades, total_volume, win_rate, entry_score, overall_score, last_trade_at')
      .in('address', addresses);

    if (error) {
      console.error('Error fetching watchlist wallets:', error);
    } else {
      setWallets(data || []);
    }
    setIsLoading(false);
  }

  function addToWatchlist(address: string) {
    const newAddresses = new Set(watchlistAddresses);
    newAddresses.add(address);
    setWatchlistAddresses(newAddresses);
    localStorage.setItem('watchlist', JSON.stringify([...newAddresses]));
    fetchWallets([...newAddresses]);
  }

  function removeFromWatchlist(address: string) {
    const newAddresses = new Set(watchlistAddresses);
    newAddresses.delete(address);
    setWatchlistAddresses(newAddresses);
    localStorage.setItem('watchlist', JSON.stringify([...newAddresses]));
    setWallets(wallets.filter(w => w.address !== address));
  }

  function isInWatchlist(address: string) {
    return watchlistAddresses.has(address);
  }

  return {
    wallets,
    isLoading,
    addToWatchlist,
    removeFromWatchlist,
    isInWatchlist,
  };
}
