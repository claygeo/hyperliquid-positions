-- Row Level Security policies

-- Enable RLS on tables
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

-- Wallets: Public read, no direct write from client
CREATE POLICY "Wallets are viewable by everyone" ON wallets
  FOR SELECT USING (true);

-- Trades: Public read, no direct write from client  
CREATE POLICY "Trades are viewable by everyone" ON trades
  FOR SELECT USING (true);

-- Positions: Public read, no direct write from client
CREATE POLICY "Positions are viewable by everyone" ON positions
  FOR SELECT USING (true);

-- Signals: Public read, no direct write from client
CREATE POLICY "Signals are viewable by everyone" ON signals
  FOR SELECT USING (true);

-- Clusters: Public read, no direct write from client
CREATE POLICY "Clusters are viewable by everyone" ON clusters
  FOR SELECT USING (true);

-- User settings: Users can only access their own settings
CREATE POLICY "Users can view own settings" ON user_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings" ON user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings" ON user_settings
  FOR UPDATE USING (auth.uid() = user_id);

-- Watchlist: Users can only access their own watchlist
CREATE POLICY "Users can view own watchlist" ON watchlist
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert to own watchlist" ON watchlist
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own watchlist" ON watchlist
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete from own watchlist" ON watchlist
  FOR DELETE USING (auth.uid() = user_id);

-- Service role bypass (for collector)
-- The service role key bypasses RLS automatically
