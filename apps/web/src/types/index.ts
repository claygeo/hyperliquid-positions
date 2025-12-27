// Frontend-specific types

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export interface TableColumn<T> {
  key: keyof T | string;
  label: string;
  sortable?: boolean;
  render?: (value: unknown, row: T) => React.ReactNode;
  className?: string;
}

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
}

export interface SortState {
  field: string;
  order: 'asc' | 'desc';
}

export interface FilterOption {
  value: string;
  label: string;
}

export interface ChartDataPoint {
  date: string;
  value: number;
  label?: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  description?: string;
  duration?: number;
}

// Re-export shared types for convenience
export type {
  Wallet,
  WalletScore,
  WalletPosition,
  WalletTrade,
  WalletFilter,
  WalletSortField,
  Signal,
  SignalType,
  SignalFilter,
} from '@hyperliquid-tracker/shared';
