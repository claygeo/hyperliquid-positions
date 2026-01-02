// Debug script to investigate P&L calculation discrepancy
// Run with: npx tsx debug-fills.ts

import 'dotenv/config';

const ADDRESS = '0xbd21c5a128247f60653cb652276c10e9f6dd8c02';

async function debugFills() {
  console.log('='.repeat(60));
  console.log('DEBUGGING P&L CALCULATION');
  console.log('='.repeat(60));
  console.log(`Trader: ${ADDRESS}`);
  console.log('');

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  
  // ============================================
  // 1. Get fills from Hyperliquid API
  // ============================================
  console.log('Fetching fills from Hyperliquid API...');
  
  const fillsResponse = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'userFills',
      user: ADDRESS,
      startTime: sevenDaysAgo,
    }),
  });
  
  const fills = await fillsResponse.json();
  
  console.log(`Total fills in last 7 days: ${fills.length}`);
  console.log('');

  // ============================================
  // 2. Analyze closedPnl field
  // ============================================
  let totalClosedPnl = 0;
  let fillsWithPnl = 0;
  let fillsWithoutPnl = 0;
  
  const pnlByDay: Record<string, number> = {};
  const pnlByCoin: Record<string, number> = {};
  
  console.log('='.repeat(60));
  console.log('FILLS WITH CLOSED P&L (showing first 30):');
  console.log('='.repeat(60));
  
  let shown = 0;
  for (const fill of fills) {
    const pnl = parseFloat(fill.closedPnl || '0');
    
    if (pnl !== 0) {
      fillsWithPnl++;
      totalClosedPnl += pnl;
      
      // Group by day
      const day = new Date(fill.time).toISOString().split('T')[0];
      pnlByDay[day] = (pnlByDay[day] || 0) + pnl;
      
      // Group by coin
      pnlByCoin[fill.coin] = (pnlByCoin[fill.coin] || 0) + pnl;
      
      if (shown < 30) {
        const time = new Date(fill.time).toLocaleString();
        const side = fill.side || fill.dir || 'unknown';
        console.log(
          `${fill.coin.padEnd(8)} | ${side.padEnd(12)} | ` +
          `closedPnl: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2).padStart(10)} | ` +
          `${time}`
        );
        shown++;
      }
    } else {
      fillsWithoutPnl++;
    }
  }
  
  if (fillsWithPnl > 30) {
    console.log(`... and ${fillsWithPnl - 30} more fills with P&L`);
  }

  // ============================================
  // 3. Summary
  // ============================================
  console.log('');
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Fills with closedPnl: ${fillsWithPnl}`);
  console.log(`Fills without closedPnl: ${fillsWithoutPnl}`);
  console.log('');
  console.log(`TOTAL closedPnl sum: $${totalClosedPnl.toFixed(2)}`);
  console.log('');
  
  // ============================================
  // 4. P&L by day
  // ============================================
  console.log('P&L BY DAY:');
  const sortedDays = Object.entries(pnlByDay).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [day, pnl] of sortedDays) {
    console.log(`  ${day}: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
  }
  console.log('');
  
  // ============================================
  // 5. P&L by coin
  // ============================================
  console.log('P&L BY COIN:');
  const sortedCoins = Object.entries(pnlByCoin).sort((a, b) => b[1] - a[1]);
  for (const [coin, pnl] of sortedCoins) {
    console.log(`  ${coin.padEnd(8)}: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
  }
  console.log('');

  // ============================================
  // 6. Get account state for comparison
  // ============================================
  console.log('='.repeat(60));
  console.log('ACCOUNT STATE (for ROI calculation context)');
  console.log('='.repeat(60));
  
  const stateResponse = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'clearinghouseState',
      user: ADDRESS,
    }),
  });
  
  const state = await stateResponse.json();
  const accountValue = parseFloat(state.marginSummary?.accountValue || '0');
  const withdrawable = parseFloat(state.withdrawable || '0');
  
  console.log(`Account Value: $${accountValue.toFixed(2)}`);
  console.log(`Withdrawable: $${withdrawable.toFixed(2)}`);
  console.log('');
  
  // ============================================
  // 7. The key question
  // ============================================
  console.log('='.repeat(60));
  console.log('THE DISCREPANCY');
  console.log('='.repeat(60));
  console.log(`Our calculated 7d P&L: $${totalClosedPnl.toFixed(2)}`);
  console.log(`Hyperdash shows 1W P&L: ~$4,400`);
  console.log('');
  
  if (totalClosedPnl > 10000) {
    console.log('⚠️  PROBLEM CONFIRMED: Our sum is WAY higher than Hyperdash');
    console.log('');
    console.log('Possible causes:');
    console.log('1. closedPnl is cumulative, not per-fill');
    console.log('2. We are double-counting partial fills');
    console.log('3. closedPnl includes unrealized P&L');
    console.log('4. Time filter is not working correctly');
  } else {
    console.log('✓ Our calculation seems reasonable');
  }

  // ============================================
  // 8. Check raw fill structure
  // ============================================
  console.log('');
  console.log('='.repeat(60));
  console.log('RAW FILL STRUCTURE (first fill with P&L):');
  console.log('='.repeat(60));
  
  const firstFillWithPnl = fills.find((f: any) => parseFloat(f.closedPnl || '0') !== 0);
  if (firstFillWithPnl) {
    console.log(JSON.stringify(firstFillWithPnl, null, 2));
  }
  
  // ============================================
  // 9. Check if closedPnl might be cumulative
  // ============================================
  console.log('');
  console.log('='.repeat(60));
  console.log('CHECKING IF closedPnl IS CUMULATIVE:');
  console.log('='.repeat(60));
  
  // Get last few fills and see if closedPnl increases monotonically
  const recentFillsWithPnl = fills
    .filter((f: any) => parseFloat(f.closedPnl || '0') !== 0)
    .slice(0, 10);
  
  console.log('Last 10 fills with P&L (check if values are cumulative):');
  for (const fill of recentFillsWithPnl) {
    const pnl = parseFloat(fill.closedPnl);
    const time = new Date(fill.time).toLocaleString();
    console.log(`  ${fill.coin.padEnd(8)} | closedPnl: $${pnl.toFixed(2).padStart(10)} | ${time}`);
  }
}

debugFills().catch(console.error);