-- Trades table
-- Stores individual trade/fill records

CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  coin TEXT NOT NULL,
  side CHAR(1) NOT NULL CHECK (side IN ('B', 'A')),
  size DECIMAL(20, 8) NOT NULL,
  price DECIMAL(20, 8) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  tx_hash TEXT NOT NULL,
  oid BIGINT NOT NULL,
  is_taker BOOLEAN NOT NULL DEFAULT true,
  fee DECIMAL(20, 8) NOT NULL DEFAULT 0,
  
  -- PnL tracking
  closed_pnl DECIMAL(20, 8),
  
  -- Entry scoring (filled in later by backfill job)
  price_5m_later DECIMAL(20, 8),
  price_1h_later DECIMAL(20, 8),
  price_4h_later DECIMAL(20, 8),
  entry_score DECIMAL(5, 4),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS trades_wallet_hash_oid_idx 
  ON trades(wallet, tx_hash, oid);

-- Comments
COMMENT ON TABLE trades IS 'Individual trade records from fills';
COMMENT ON COLUMN trades.side IS 'B = Buy, A = Ask (Sell)';
COMMENT ON COLUMN trades.entry_score IS 'Quality of entry timing, -1 to 1';
