// Bootstrap Equity Snapshots - DEBUG VERSION
// Shows actual error messages

import 'dotenv/config';
import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import hyperliquid from '../utils/hyperliquid-api.js';

const logger = createLogger('bootstrap-equity');

async function saveSnapshot(address: string, accountValue: number): Promise<{ success: boolean; error?: string }> {
  const today = new Date().toISOString().split('T')[0];
  
  const { data, error } = await db.client.from('trader_equity_history').upsert({
    address: address.toLowerCase(),
    snapshot_date: today,
    account_value: accountValue,
    peak_value: accountValue,
    drawdown_pct: 0,
    daily_pnl: 0,
    daily_roi_pct: 0,
    trades_count: 0,
    wins_count: 0,
    losses_count: 0,
  }, { 
    onConflict: 'address,snapshot_date',
  });
  
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

async function bootstrapEquitySnapshots() {
  console.log('='.repeat(60));
  console.log('BOOTSTRAPPING EQUITY SNAPSHOTS (DEBUG)');
  console.log('='.repeat(60));
  console.log(`Date: ${new Date().toISOString().split('T')[0]}`);
  console.log('');

  // Get all tracked traders
  const { data: traders, error } = await db.client
    .from('trader_quality')
    .select('address, account_value')
    .eq('is_tracked', true);

  if (error || !traders) {
    console.error('Failed to fetch traders:', error);
    return;
  }

  console.log(`Found ${traders.length} tracked traders`);
  console.log('');

  let saved = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < traders.length; i++) {
    const trader = traders[i];
    
    // Get fresh account state from API
    const state = await hyperliquid.getClearinghouseState(trader.address);
    
    if (state) {
      const accountValue = parseFloat(state.marginSummary.accountValue);
      const result = await saveSnapshot(trader.address, accountValue);
      
      if (result.success) {
        saved++;
        console.log(`  ✓ ${trader.address.slice(0, 10)}... | $${accountValue.toFixed(0)}`);
      } else {
        failed++;
        if (!errors.includes(result.error || '')) {
          errors.push(result.error || 'Unknown error');
        }
        console.log(`  ✗ ${trader.address.slice(0, 10)}... | ERROR: ${result.error}`);
      }
    } else {
      failed++;
      console.log(`  ✗ ${trader.address.slice(0, 10)}... | ERROR: Could not get account state`);
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`  Snapshots saved: ${saved}`);
  console.log(`  Failed: ${failed}`);
  
  if (errors.length > 0) {
    console.log('');
    console.log('Unique errors encountered:');
    errors.forEach(e => console.log(`  - ${e}`));
  }

  console.log('');
  console.log('Done!');
  
  process.exit(0);
}

bootstrapEquitySnapshots().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});