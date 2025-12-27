import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WatchlistState {
  addresses: string[];
  addWallet: (address: string) => void;
  removeWallet: (address: string) => void;
  isWatching: (address: string) => boolean;
  clearAll: () => void;
}

export const useWatchlistStore = create<WatchlistState>()(
  persist(
    (set, get) => ({
      addresses: [],

      addWallet: (address: string) => {
        const { addresses } = get();
        if (!addresses.includes(address)) {
          set({ addresses: [...addresses, address] });
        }
      },

      removeWallet: (address: string) => {
        const { addresses } = get();
        set({ addresses: addresses.filter((a) => a !== address) });
      },

      isWatching: (address: string) => {
        return get().addresses.includes(address);
      },

      clearAll: () => {
        set({ addresses: [] });
      },
    }),
    {
      name: 'watchlist-storage',
    }
  )
);
