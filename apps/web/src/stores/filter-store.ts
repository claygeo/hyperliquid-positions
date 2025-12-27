import { create } from 'zustand';
import type { WalletSortField } from '@hyperliquid-tracker/shared';

interface FilterState {
  // Wallet filters
  minScore: number | undefined;
  minTrades: number | undefined;
  minVolume: number | undefined;
  minWinRate: number | undefined;
  sortBy: WalletSortField;
  sortOrder: 'asc' | 'desc';

  // Signal filters
  signalTypes: string[];
  signalMinConfidence: number;

  // Actions
  setMinScore: (value: number | undefined) => void;
  setMinTrades: (value: number | undefined) => void;
  setMinVolume: (value: number | undefined) => void;
  setMinWinRate: (value: number | undefined) => void;
  setSortBy: (field: WalletSortField) => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  toggleSort: (field: WalletSortField) => void;
  setSignalTypes: (types: string[]) => void;
  toggleSignalType: (type: string) => void;
  setSignalMinConfidence: (value: number) => void;
  resetFilters: () => void;
}

const defaultState = {
  minScore: undefined,
  minTrades: 20,
  minVolume: undefined,
  minWinRate: undefined,
  sortBy: 'overall_score' as WalletSortField,
  sortOrder: 'desc' as const,
  signalTypes: [],
  signalMinConfidence: 0,
};

export const useFilterStore = create<FilterState>((set, get) => ({
  ...defaultState,

  setMinScore: (value) => set({ minScore: value }),
  setMinTrades: (value) => set({ minTrades: value }),
  setMinVolume: (value) => set({ minVolume: value }),
  setMinWinRate: (value) => set({ minWinRate: value }),
  setSortBy: (field) => set({ sortBy: field }),
  setSortOrder: (order) => set({ sortOrder: order }),

  toggleSort: (field) => {
    const { sortBy, sortOrder } = get();
    if (sortBy === field) {
      set({ sortOrder: sortOrder === 'asc' ? 'desc' : 'asc' });
    } else {
      set({ sortBy: field, sortOrder: 'desc' });
    }
  },

  setSignalTypes: (types) => set({ signalTypes: types }),

  toggleSignalType: (type) => {
    const { signalTypes } = get();
    if (signalTypes.includes(type)) {
      set({ signalTypes: signalTypes.filter((t) => t !== type) });
    } else {
      set({ signalTypes: [...signalTypes, type] });
    }
  },

  setSignalMinConfidence: (value) => set({ signalMinConfidence: value }),

  resetFilters: () => set(defaultState),
}));
