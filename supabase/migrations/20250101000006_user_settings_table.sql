-- User settings and watchlist tables

-- User settings
CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  watchlist TEXT[] NOT NULL DEFAULT '{}',
  alert_min_score DECIMAL(5, 4) NOT NULL DEFAULT 0.6,
  alert_coins TEXT[],
  auto_copy_enabled BOOLEAN NOT NULL DEFAULT false,
  copy_percentage DECIMAL(5, 2) NOT NULL DEFAULT 10,
  max_position_size DECIMAL(20, 2) NOT NULL DEFAULT 1000,
  telegram_chat_id TEXT,
  discord_webhook TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Watchlist entries (more detailed than array in settings)
CREATE TABLE IF NOT EXISTS watchlist (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  nickname TEXT,
  notes TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(user_id, wallet_address)
);

-- Comments
COMMENT ON TABLE user_settings IS 'User preferences and alert settings';
COMMENT ON TABLE watchlist IS 'User watchlist with additional metadata';
