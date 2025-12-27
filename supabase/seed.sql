-- Seed data for development

-- Insert some sample wallets (known traders for testing)
INSERT INTO wallets (address, first_seen, total_trades, total_volume, is_active)
VALUES
  ('0x1234567890123456789012345678901234567890', NOW() - INTERVAL '30 days', 150, 500000, true),
  ('0x2345678901234567890123456789012345678901', NOW() - INTERVAL '60 days', 320, 1200000, true),
  ('0x3456789012345678901234567890123456789012', NOW() - INTERVAL '45 days', 85, 250000, true)
ON CONFLICT (address) DO NOTHING;

-- Note: In production, wallets will be discovered automatically from trade stream
