// Seed initial wallets to track
// Run with: npx tsx scripts/seed-watchlist.ts

import { config } from 'dotenv';
config();

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Known active traders to seed (example addresses)
// Replace with actual addresses you want to track
const SEED_WALLETS = [
  // Add known good traders here
  // '0x1234567890123456789012345678901234567890',
];

async function main() {
  console.log('Seeding initial wallets...');
  
  if (SEED_WALLETS.length === 0) {
    console.log('No seed wallets configured. Add addresses to SEED_WALLETS array.');
    return;
  }
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  
  const wallets = SEED_WALLETS.map(address => ({
    address,
    first_seen: new Date().toISOString(),
    total_trades: 0,
    total_volume: 0,
    is_active: true,
  }));
  
  const { data, error } = await supabase
    .from('wallets')
    .upsert(wallets, { onConflict: 'address' });
  
  if (error) {
    console.error('Error seeding wallets:', error);
    process.exit(1);
  }
  
  console.log(`Seeded ${SEED_WALLETS.length} wallets successfully.`);
}

main().catch(console.error);
