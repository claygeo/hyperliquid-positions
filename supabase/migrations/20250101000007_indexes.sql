-- Indexes for performance

-- Wallets indexes
CREATE INDEX IF NOT EXISTS wallets_overall_score_idx ON wallets(overall_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS wallets_is_active_idx ON wallets(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS wallets_last_trade_at_idx ON wallets(last_trade_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS wallets_cluster_id_idx ON wallets(cluster_id) WHERE cluster_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wallets_total_trades_idx ON wallets(total_trades DESC);

-- Trades indexes
CREATE INDEX IF NOT EXISTS trades_wallet_idx ON trades(wallet);
CREATE INDEX IF NOT EXISTS trades_timestamp_idx ON trades(timestamp DESC);
CREATE INDEX IF NOT EXISTS trades_wallet_timestamp_idx ON trades(wallet, timestamp DESC);
CREATE INDEX IF NOT EXISTS trades_coin_idx ON trades(coin);
CREATE INDEX IF NOT EXISTS trades_needs_backfill_idx ON trades(timestamp) 
  WHERE price_5m_later IS NULL;

-- Positions indexes
CREATE INDEX IF NOT EXISTS positions_wallet_idx ON positions(wallet);
CREATE INDEX IF NOT EXISTS positions_coin_idx ON positions(coin);
CREATE INDEX IF NOT EXISTS positions_updated_at_idx ON positions(updated_at DESC);
CREATE INDEX IF NOT EXISTS positions_size_nonzero_idx ON positions(wallet, coin) 
  WHERE size != 0;

-- Signals indexes
CREATE INDEX IF NOT EXISTS signals_created_at_idx ON signals(created_at DESC);
CREATE INDEX IF NOT EXISTS signals_is_active_idx ON signals(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS signals_type_idx ON signals(signal_type);
CREATE INDEX IF NOT EXISTS signals_coin_idx ON signals(coin) WHERE coin IS NOT NULL;
CREATE INDEX IF NOT EXISTS signals_wallets_idx ON signals USING GIN(wallets);

-- Clusters indexes
CREATE INDEX IF NOT EXISTS clusters_wallets_idx ON clusters USING GIN(wallets);
CREATE INDEX IF NOT EXISTS clusters_combined_score_idx ON clusters(combined_score DESC NULLS LAST);

-- Watchlist indexes
CREATE INDEX IF NOT EXISTS watchlist_user_id_idx ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS watchlist_wallet_address_idx ON watchlist(wallet_address);
