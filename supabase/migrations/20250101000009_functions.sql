-- Database functions and triggers

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_wallets_updated_at
  BEFORE UPDATE ON wallets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_positions_updated_at
  BEFORE UPDATE ON positions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_clusters_updated_at
  BEFORE UPDATE ON clusters
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Function to get top wallets by score
CREATE OR REPLACE FUNCTION get_top_wallets(
  min_score DECIMAL DEFAULT 0,
  min_trades INTEGER DEFAULT 20,
  limit_count INTEGER DEFAULT 100
)
RETURNS SETOF wallets AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM wallets
  WHERE is_active = true
    AND overall_score >= min_score
    AND total_trades >= min_trades
  ORDER BY overall_score DESC NULLS LAST
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get wallet with positions
CREATE OR REPLACE FUNCTION get_wallet_with_positions(wallet_address TEXT)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'wallet', (SELECT row_to_json(w) FROM wallets w WHERE address = wallet_address),
    'positions', (
      SELECT COALESCE(json_agg(row_to_json(p)), '[]'::json)
      FROM positions p 
      WHERE wallet = wallet_address AND size != 0
    ),
    'recent_trades', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT * FROM trades 
        WHERE wallet = wallet_address 
        ORDER BY timestamp DESC 
        LIMIT 50
      ) t
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to get active signals for a user's watchlist
CREATE OR REPLACE FUNCTION get_watchlist_signals(p_user_id UUID)
RETURNS SETOF signals AS $$
BEGIN
  RETURN QUERY
  SELECT s.*
  FROM signals s
  WHERE s.is_active = true
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
    AND s.wallets && (
      SELECT ARRAY_AGG(wallet_address)
      FROM watchlist
      WHERE user_id = p_user_id
    )
  ORDER BY s.created_at DESC
  LIMIT 100;
END;
$$ LANGUAGE plpgsql;

-- Function to get position heatmap (aggregate positions by coin)
CREATE OR REPLACE FUNCTION get_position_heatmap()
RETURNS TABLE(
  coin TEXT,
  long_count BIGINT,
  short_count BIGINT,
  total_long_size DECIMAL,
  total_short_size DECIMAL,
  avg_long_leverage DECIMAL,
  avg_short_leverage DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.coin,
    COUNT(*) FILTER (WHERE p.size > 0) as long_count,
    COUNT(*) FILTER (WHERE p.size < 0) as short_count,
    COALESCE(SUM(p.size) FILTER (WHERE p.size > 0), 0) as total_long_size,
    COALESCE(ABS(SUM(p.size) FILTER (WHERE p.size < 0)), 0) as total_short_size,
    COALESCE(AVG(p.leverage) FILTER (WHERE p.size > 0), 0) as avg_long_leverage,
    COALESCE(AVG(p.leverage) FILTER (WHERE p.size < 0), 0) as avg_short_leverage
  FROM positions p
  JOIN wallets w ON p.wallet = w.address
  WHERE p.size != 0
    AND w.is_active = true
    AND w.overall_score >= 0.5
  GROUP BY p.coin
  ORDER BY (long_count + short_count) DESC;
END;
$$ LANGUAGE plpgsql;
