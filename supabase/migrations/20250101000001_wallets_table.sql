-- Wallets table
-- Stores tracked wallet information and scores

CREATE TABLE IF NOT EXISTS wallets (
  address TEXT PRIMARY KEY,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_trades INTEGER NOT NULL DEFAULT 0,
  total_volume DECIMAL(20, 2) NOT NULL DEFAULT 0,
  
  -- Scoring metrics
  win_rate DECIMAL(5, 4),
  entry_score DECIMAL(5, 4),
  risk_adjusted_return DECIMAL(5, 4),
  avg_hold_minutes DECIMAL(10, 2),
  funding_efficiency DECIMAL(5, 4),
  overall_score DECIMAL(5, 4),
  
  -- Status
  last_trade_at TIMESTAMPTZ,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  -- Relationships
  cluster_id UUID,
  
  -- Additional data
  metadata JSONB
);

-- Comments
COMMENT ON TABLE wallets IS 'Tracked wallets with performance metrics';
COMMENT ON COLUMN wallets.entry_score IS 'Average entry timing quality, -1 to 1';
COMMENT ON COLUMN wallets.overall_score IS 'Composite score, 0 to 1';
