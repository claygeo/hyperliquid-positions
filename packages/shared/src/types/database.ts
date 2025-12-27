// Database table types (matches Supabase schema)

export interface DBWallet {
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
  last_updated: string;
  is_active: boolean;
  cluster_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface DBWalletInsert {
  address: string;
  first_seen?: string;
  total_trades?: number;
  total_volume?: number;
  win_rate?: number | null;
  entry_score?: number | null;
  risk_adjusted_return?: number | null;
  avg_hold_minutes?: number | null;
  funding_efficiency?: number | null;
  overall_score?: number | null;
  last_trade_at?: string | null;
  is_active?: boolean;
  cluster_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface DBWalletUpdate {
  total_trades?: number;
  total_volume?: number;
  win_rate?: number | null;
  entry_score?: number | null;
  risk_adjusted_return?: number | null;
  avg_hold_minutes?: number | null;
  funding_efficiency?: number | null;
  overall_score?: number | null;
  last_trade_at?: string | null;
  last_updated?: string;
  is_active?: boolean;
  cluster_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface DBTrade {
  id: number;
  wallet: string;
  coin: string;
  side: 'B' | 'A';
  size: number;
  price: number;
  timestamp: string;
  tx_hash: string;
  oid: number;
  is_taker: boolean;
  fee: number;
  closed_pnl: number | null;
  price_5m_later: number | null;
  price_1h_later: number | null;
  price_4h_later: number | null;
  entry_score: number | null;
  created_at: string;
}

export interface DBTradeInsert {
  wallet: string;
  coin: string;
  side: 'B' | 'A';
  size: number;
  price: number;
  timestamp: string;
  tx_hash: string;
  oid: number;
  is_taker: boolean;
  fee: number;
  closed_pnl?: number | null;
  price_5m_later?: number | null;
  price_1h_later?: number | null;
  price_4h_later?: number | null;
  entry_score?: number | null;
}

export interface DBPosition {
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

export interface DBPositionUpsert {
  wallet: string;
  coin: string;
  size: number;
  entry_price: number;
  leverage: number;
  leverage_type: 'cross' | 'isolated';
  unrealized_pnl: number;
  liquidation_price?: number | null;
  margin_used: number;
}

export interface DBCluster {
  id: string;
  wallets: string[];
  confidence: number;
  detection_method: 'transfer' | 'timing' | 'both';
  total_volume: number;
  combined_score: number | null;
  created_at: string;
  updated_at: string;
}

export interface DBClusterInsert {
  wallets: string[];
  confidence: number;
  detection_method: 'transfer' | 'timing' | 'both';
  total_volume?: number;
  combined_score?: number | null;
}

export interface DBSignal {
  id: number;
  signal_type: SignalType;
  wallets: string[];
  coin: string | null;
  direction: 'long' | 'short' | null;
  confidence: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
  expires_at: string | null;
  is_active: boolean;
}

export type SignalType =
  | 'new_position'
  | 'position_increase'
  | 'position_close'
  | 'cluster_convergence'
  | 'unusual_size'
  | 'high_score_entry';

export interface DBSignalInsert {
  signal_type: SignalType;
  wallets: string[];
  coin?: string | null;
  direction?: 'long' | 'short' | null;
  confidence: number;
  metadata?: Record<string, unknown> | null;
  expires_at?: string | null;
}

export interface DBUserSettings {
  user_id: string;
  watchlist: string[];
  alert_min_score: number;
  alert_coins: string[] | null;
  auto_copy_enabled: boolean;
  copy_percentage: number;
  max_position_size: number;
  telegram_chat_id: string | null;
  discord_webhook: string | null;
  created_at: string;
  updated_at: string;
}

export interface DBUserSettingsUpsert {
  user_id: string;
  watchlist?: string[];
  alert_min_score?: number;
  alert_coins?: string[] | null;
  auto_copy_enabled?: boolean;
  copy_percentage?: number;
  max_position_size?: number;
  telegram_chat_id?: string | null;
  discord_webhook?: string | null;
}

export interface DBWatchlistEntry {
  id: number;
  user_id: string;
  wallet_address: string;
  nickname: string | null;
  notes: string | null;
  added_at: string;
}

export interface DBWatchlistInsert {
  user_id: string;
  wallet_address: string;
  nickname?: string | null;
  notes?: string | null;
}

// Price cache for entry scoring
export interface DBPriceCache {
  coin: string;
  timestamp: string;
  price: number;
}
