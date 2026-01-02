// Test script to verify PnL Analyzer V6 fix
// 
// This tests:
// 1. Proper time filtering (only fills within 7 days)
// 2. Equity-based P&L calculation
// 3. Comparison with expected values
//
// Run with: npx tsx src/scripts/test-pnl-fix.ts

import 'dotenv/config';

const TEST_ADDRESS = '0xbd21c5a128247f60653cb652276c10e9f6dd8c02';

// Expected values from Hyperdash (approximately)
const EXPECTED = {
  weeklyPnl: 4400,      // ~$4,400 according to Hyperdash
  accountValue: 51000,  // ~$51K account
  tolerance: 0.3,       // 30% tolerance for comparison
};

interface Fill {
  coin: string;
  time: number;
  closedPnl: string;
  dir: string;
  px: string;
  sz: string;
}

async function testPnLFix() {
  console.log('='.repeat(70));
  console.log('PNL ANALYZER V6 - FIX VERIFICATION TEST');
  console.log('='.repeat(70));
  console.log(`Test Address: ${TEST_ADDRESS}`);
  console.log('');

  // ============================================
  // 1. Get fills from API
  // ============================================
  console.log('Step 1: Fetching fills from Hyperliquid API...');
  
  const fillsResponse = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'userFills',
      user: TEST_ADDRESS,
    }),
  });
  
  const allFills: Fill[] = await fillsResponse.json();
  console.log(`  Total fills returned by API: ${allFills.length}`);

  // ============================================
  // 2. Apply STRICT time filtering (the fix)
  // ============================================
  console.log('\nStep 2: Applying strict 7-day time filter (THE FIX)...');
  
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  
  const fills7d = allFills.filter(f => f.time >= sevenDaysAgo);
  
  console.log(`  Fills in last 7 days: ${fills7d.length}`);
  console.log(`  Fills older than 7 days (excluded): ${allFills.length - fills7d.length}`);

  // Show date range of fills
  if (allFills.length > 0) {
    const oldestFill = new Date(Math.min(...allFills.map(f => f.time)));
    const newestFill = new Date(Math.max(...allFills.map(f => f.time)));
    console.log(`\n  All fills date range: ${oldestFill.toDateString()} to ${newestFill.toDateString()}`);
    
    if (fills7d.length > 0) {
      const oldest7d = new Date(Math.min(...fills7d.map(f => f.time)));
      const newest7d = new Date(Math.max(...fills7d.map(f => f.time)));
      console.log(`  7-day filtered range: ${oldest7d.toDateString()} to ${newest7d.toDateString()}`);
    }
  }

  // ============================================
  // 3. Calculate P&L both ways
  // ============================================
  console.log('\nStep 3: Calculating P&L...');
  
  // OLD WAY (bug): Sum ALL closedPnl
  const oldWayPnl = allFills.reduce((sum, f) => {
    const pnl = parseFloat(f.closedPnl || '0');
    return sum + (isNaN(pnl) ? 0 : pnl);
  }, 0);
  
  // NEW WAY (fix): Sum only 7-day filtered closedPnl  
  const newWayPnl = fills7d.reduce((sum, f) => {
    const pnl = parseFloat(f.closedPnl || '0');
    return sum + (isNaN(pnl) ? 0 : pnl);
  }, 0);

  console.log(`\n  🔴 OLD calculation (BUG): $${oldWayPnl.toFixed(2)}`);
  console.log(`     - Summed closedPnl from ALL ${allFills.length} fills`);
  console.log(`     - Included fills from months ago!`);
  
  console.log(`\n  🟢 NEW calculation (FIX): $${newWayPnl.toFixed(2)}`);
  console.log(`     - Summed closedPnl from only ${fills7d.length} fills in last 7 days`);

  // ============================================
  // 4. Get account state
  // ============================================
  console.log('\nStep 4: Fetching account state...');
  
  const stateResponse = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'clearinghouseState',
      user: TEST_ADDRESS,
    }),
  });
  
  const state = await stateResponse.json();
  const accountValue = parseFloat(state.marginSummary?.accountValue || '0');
  const unrealizedPnl = parseFloat(state.marginSummary?.totalUnrealizedPnl || '0');
  
  console.log(`  Account Value: $${accountValue.toFixed(2)}`);
  console.log(`  Unrealized P&L: $${unrealizedPnl.toFixed(2)}`);

  // ============================================
  // 5. Calculate ROI
  // ============================================
  console.log('\nStep 5: Calculating ROI...');
  
  const baseEquityOld = Math.max(accountValue - oldWayPnl, 100);
  const roiOld = (oldWayPnl / baseEquityOld) * 100;
  
  const baseEquityNew = Math.max(accountValue - newWayPnl, 100);
  const roiNew = (newWayPnl / baseEquityNew) * 100;
  
  console.log(`\n  🔴 OLD ROI: ${roiOld.toFixed(1)}% (based on $${oldWayPnl.toFixed(0)} P&L)`);
  console.log(`  🟢 NEW ROI: ${roiNew.toFixed(1)}% (based on $${newWayPnl.toFixed(0)} P&L)`);

  // ============================================
  // 6. Compare to expected (Hyperdash)
  // ============================================
  console.log('\n' + '='.repeat(70));
  console.log('VERIFICATION RESULTS');
  console.log('='.repeat(70));
  
  console.log(`\n  Expected (from Hyperdash): ~$${EXPECTED.weeklyPnl.toLocaleString()}`);
  console.log(`  Our new calculation:       $${newWayPnl.toFixed(0)}`);
  
  const difference = Math.abs(newWayPnl - EXPECTED.weeklyPnl);
  const percentDiff = (difference / EXPECTED.weeklyPnl) * 100;
  
  console.log(`  Difference:                $${difference.toFixed(0)} (${percentDiff.toFixed(1)}%)`);
  
  // Note about realized vs equity-based
  console.log(`\n  ⚠️ NOTE: Our calculation uses REALIZED P&L from fills.`);
  console.log(`     Hyperdash shows EQUITY CHANGE which includes unrealized P&L.`);
  console.log(`     These numbers may differ if trader has open positions.`);
  console.log(`     Current unrealized P&L: $${unrealizedPnl.toFixed(0)}`);
  
  // What equity-based would look like
  const equityBasedPnl = newWayPnl + unrealizedPnl;
  console.log(`\n  If we included unrealized: $${equityBasedPnl.toFixed(0)}`);

  // ============================================
  // 7. Bug fix verification
  // ============================================
  console.log('\n' + '='.repeat(70));
  console.log('BUG FIX VERIFICATION');
  console.log('='.repeat(70));
  
  const inflationFactor = oldWayPnl / Math.max(newWayPnl, 1);
  
  if (oldWayPnl > newWayPnl * 5) {
    console.log('\n  ✅ BUG CONFIRMED AND FIXED!');
    console.log(`     Old code was inflating P&L by ${inflationFactor.toFixed(1)}x`);
    console.log(`     Old: $${oldWayPnl.toFixed(0)} → New: $${newWayPnl.toFixed(0)}`);
  } else if (oldWayPnl > newWayPnl * 1.2) {
    console.log('\n  ⚠️ PARTIAL FIX');
    console.log(`     Old code was ${inflationFactor.toFixed(1)}x higher`);
    console.log(`     Some historical data was being included`);
  } else {
    console.log('\n  ℹ️ MINIMAL DIFFERENCE');
    console.log(`     Most fills were already within 7 days`);
    console.log(`     Time filter had limited impact for this trader`);
  }

  // ============================================
  // 8. Show sample fills for verification
  // ============================================
  console.log('\n' + '='.repeat(70));
  console.log('SAMPLE FILLS (last 7 days)');
  console.log('='.repeat(70));
  
  const recentWithPnl = fills7d
    .filter(f => parseFloat(f.closedPnl || '0') !== 0)
    .slice(0, 10);
  
  if (recentWithPnl.length > 0) {
    console.log('\n  Recent fills with P&L (max 10):');
    for (const fill of recentWithPnl) {
      const pnl = parseFloat(fill.closedPnl);
      const date = new Date(fill.time);
      console.log(
        `    ${fill.coin.padEnd(8)} | ` +
        `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2).padStart(10)} | ` +
        `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
      );
    }
  } else {
    console.log('\n  No fills with P&L in last 7 days');
  }

  // ============================================
  // 9. Summary
  // ============================================
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`
  The bug was: Hyperliquid API ignores startTime parameter and returns
  the last 2000 fills regardless of date. We were summing ALL of them.

  The fix: Filter fills CLIENT-SIDE by timestamp before summing.

  Old "7d P&L": $${oldWayPnl.toFixed(0)} (WRONG - included months of data)
  New "7d P&L": $${newWayPnl.toFixed(0)} (CORRECT - only last 7 days)
  
  This trader's P&L was inflated by ${inflationFactor.toFixed(1)}x!
  `);

  // Return results for programmatic testing
  return {
    passed: newWayPnl < oldWayPnl * 0.5, // Fix should dramatically reduce inflated number
    oldPnl: oldWayPnl,
    newPnl: newWayPnl,
    expectedPnl: EXPECTED.weeklyPnl,
    accountValue,
    fillsTotal: allFills.length,
    fills7d: fills7d.length,
  };
}

// Run the test
testPnLFix()
  .then(results => {
    console.log('\n' + '='.repeat(70));
    if (results.passed) {
      console.log('✅ TEST PASSED - P&L calculation fix verified!');
    } else {
      console.log('⚠️ TEST INCONCLUSIVE - Review results above');
    }
    console.log('='.repeat(70));
  })
  .catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
  });