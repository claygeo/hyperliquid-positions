-- Positions table
-- Stores current open positions for tracked wallets

CREATE TABLE IF NOT EXISTS positions (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  coin TEXT NOT NULL,
  size DECIMAL(20, 8) NOT NULL,
  entry_price DECIMAL(20, 8) NOT NULL,
  leverage DECIMAL(6, 2) NOT NULL,
  leverage_type TEXT NOT NULL CHECK (leverage_type IN ('cross', 'isolated')),
  unrealized_pnl DECIMAL(20, 8) NOT NULL DEFAULT 0,
  liquidation_price DECIMAL(20, 8),
  margin_used DECIMAL(20, 8) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint: one position per wallet per coin
  UNIQUE(wallet, coin)
);

-- Comments
COMMENT ON TABLE positions IS 'Current open positions for tracked wallets';
COMMENT ON COLUMN positions.size IS 'Signed size - positive for long, negative for short';
