// Bootstrap Equity Snapshots
// 
// This script saves today's equity snapshot for all tracked traders.
// Run this daily (via cron or manually) to build up history.
// After 7+ days, P&L calculations will use equity change instead of realized sum.
//
// Run with: npm run bootstrap-equity

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import hyperliquid from '../utils/hyperliquid-api.js';

const logger = createLogger('bootstrap-equity');

async function saveSnapshot(address: string, accountValue: number): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  
  const { error } = await db.client.from('trader_equity_history').upsert({
    address: address.toLowerCase(),
    snapshot_date: today,
    account_value: accountValue,
    updated_at: new Date().toISOString(),
  }, { 
    onConflict: 'address,snapshot_date',
  });
  
  return !error;
}

async function bootstrapEquitySnapshots() {
  console.log('='.repeat(60));
  console.log('BOOTSTRAPPING EQUITY SNAPSHOTS');
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
  let updated = 0;

  for (let i = 0; i < traders.length; i++) {
    const trader = traders[i];
    
    // Get fresh account state from API
    const state = await hyperliquid.getClearinghouseState(trader.address);
    
    if (state) {
      const accountValue = parseFloat(state.marginSummary.accountValue);
      const success = await saveSnapshot(trader.address, accountValue);
      
      if (success) {
        saved++;
        // Check if value changed significantly
        const change = accountValue - (trader.account_value || 0);
        const changePct = trader.account_value ? (change / trader.account_value * 100) : 0;
        
        if (Math.abs(changePct) > 5) {
          console.log(
            `  ${trader.address.slice(0, 10)}... | ` +
            `$${accountValue.toFixed(0).padStart(8)} | ` +
            `${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}% change`
          );
          updated++;
        }
      } else {
        failed++;
      }
    } else {
      failed++;
    }

    // Progress
    if ((i + 1) % 10 === 0) {
      console.log(`  Progress: ${i + 1}/${traders.length}`);
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`  Snapshots saved: ${saved}`);
  console.log(`  Significant changes: ${updated}`);
  console.log(`  Failed: ${failed}`);
  console.log('');

  // Check how many days of history we have
  const { data: historyCount } = await db.client
    .from('trader_equity_history')
    .select('snapshot_date')
    .limit(1000);

  if (historyCount) {
    const uniqueDates = new Set(historyCount.map(h => h.snapshot_date));
    console.log(`  Total unique snapshot dates: ${uniqueDates.size}`);
    
    if (uniqueDates.size < 7) {
      console.log('');
      console.log('  ⚠️  Need 7+ days of snapshots for accurate P&L calculation');
      console.log('  Run this script daily to build history');
    } else {
      console.log('');
      console.log('  ✅ Have enough history for equity-based P&L!');
    }
  }

  console.log('');
  console.log('Done!');
  
  // Exit cleanly
  process.exit(0);
}

bootstrapEquitySnapshots().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});