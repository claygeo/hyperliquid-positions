// Import Bridgers ($10k+) - Add to trader_quality for analysis
// Run with: npx tsx src/scripts/import-bridgers.ts

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

// 81 wallets that bridged $10k+ to Hyperliquid
const BRIDGERS = [
  '0x6ea3c2e9050649954a4cfdcee3e3d2034b0ebe38',
  '0x0ecde54796d5c0bd0e958f13c6ec111b30b9f9d6',
  '0x1b14f899b1bc22add6df45da3a3423f5ceed8480',
  '0xee9495f6f6ee548c6d441c366a7021a7befc4acf',
  '0x48e409d8d5700ec9b390b6164effc3266b0fae31',
  '0xb05e78d739917f1581dd5775d4fc42f8d6165847',
  '0x54616fac8396a378f1083b9f755309d9e94b8fae',
  '0xf032648dfd22c4d81588bd83e09ab89cfe816705',
  '0x677b55b428ad095c10ec121dd1389cfc6c48f0b7',
  '0x26bbf336f851d259d687f517d8e65a8bf7a9e349',
  '0xf388d9a77b3b9c9e5c8018168da0b1404ed4d328',
  '0x196313fb2df7ac913bb6f4fedef8f434c2b03e6d',
  '0x9447857d86af4078afec6cc65d5f41f098e97f26',
  '0x98d3afaf4f9c24b12ad5f23b44aa1873ffccc9b6',
  '0x7d6fc0ee4aa797e091fb1f67bbb016b0dc5820fe',
  '0x068ba1137ccb10f0392135476ef3b1a12ff3586a',
  '0x8f9a93c10164892582faaa75d8c2e000442b4484',
  '0xef0c8367a6a1d1a35c5b65732b7e266004d6bb43',
  '0xc1c94d3677f8876664dd555559ec8f726352dd2d',
  '0x3979bdf742ce46c9dcd570c70d2d6e88b87df0e9',
  '0xd4da65123ef4a70ff8a1e0777ce634d881f99b16',
  '0x6a0d674cdbc9669247223fc1d7e07fc42b9937cd',
  '0x6b79d620f6d14bc4a9d579f2bd06570a794bc2f7',
  '0xf6695567c82db6e2faef7707e6cf3025183b1cad',
  '0xbdbc29d1319817b6f75f46393f7e84d46073c736',
  '0x9940048d0a2e62ccf34157161121e9c0ef2faa37',
  '0x3f3dda04cf0baf15d7218b6a1c7e7abb892fef99',
  '0x984fc8e6807533af55d0b572e8a35f45177a630c',
  '0x6b17e9f380c0f991800bef4fd44fe0e3c6f98363',
  '0x0f46573a97a453749cacf3d9436a1e3806441014',
  '0x8f50b637e40e2f80be45fde317c94312f529769f',
  '0xa8feeab93629cd1129b74b7a674acbe2fb5fdb9e',
  '0x41e345e3e7dd421ed2894ec85cbf1c76766f6752',
  '0x75acd5ef326d88d0db81e5a34d80f800022a5ffd',
  '0x4a7af4b39f77c2c1787fb17dfd01f517fa265ffc',
  '0xbc690fc710d3ba261c6632a50519391fda85a364',
  '0x895fc1dac3033034de8567de6eebc804416b9a99',
  '0xc403fb9908ff4ba4fb96a2057e53f132457a69aa',
  '0xc074ba3923e7044cf226b170d75168175d888a52',
  '0x0c0606e2e82ec80752e9fef3203327c8fbf26864',
  '0xf851a52b0b7d670108ac64e3c53763ce4e893e44',
  '0x1db8773dccb27647f3018acd9b7504e2fe68c31e',
  '0x60b24608562a369f14d3b5f89a4853622705d276',
  '0xbcf45610ad998526d5924d132cb8f24c5e93f591',
  '0xb5a8af933299e4039a45d41c497960439e5b34cc',
  '0x80039352c43392d2503a1df3b2eb1776243c0e99',
  '0x73e0b996c45379f3d42fc05826135553aea7de26',
  '0x0e49b4719ff132d07203ebf0f75ea2d7399b34eb',
  '0xac9bd867d1e20cc558e55270625a866c032277f9',
  '0x13372906f923ae0e8e22bfe8bcb06674059aaa38',
  '0xf896a762044d3d0ba93cbefa57958eae288f0962',
  '0xf0b4669666781b7f4f104d5136868170bd491bcc',
  '0x5705f332280dbfc30aafe894ce4e0cb3ace4e9da',
  '0x2bc47c40834772b947946c348514ec8ab2240144',
  '0x4a96036fb1529561fa3eeeb2781fad2d4f25500e',
  '0x1daa82af775ac0a465f0f52646a1bbd67aa4ebe2',
  '0x0b30e83945c797d599229272f97c2f4a792fae72',
  '0x4979927b7f5bf6a5e372ea0d5eba324f8b059a89',
  '0xf9a55c950578188650b8b1b2f046c869988b7862',
  '0x90d9a0dd139569e581c9dee41c7020c024259673',
  '0x1e11c755f27a0068af83b5a5da86cfb72380537c',
  '0x230a7de01342f754f51fe8f3c6aee4eaa201f00c',
  '0xadcafb6265a793c97c6bde5a4d9deb2e8c73f85f',
  '0xd158361f7070d9d0c5c7b6582076e29d90cad118',
  '0xd674d9dbea02b7457408ed2cd21051498ec8d13c',
  '0x92734c441d400603180e47dd842bbc3d2d630a99',
  '0x7e7b2df3202b9f83abba73fbfa679f8719ba5367',
  '0x158f76b84e75b32ff3f80e026d47b3411c126250',
  '0xe0676ef73fe2b8dc950f0eba4a9f171f3408dcf5',
  '0xb0709d2c8db9b5312a2a16cf8b252504f07bee19',
  '0x00897e2d7168165b81558c3cd9257efb007f2410',
  '0x56f2c4cb8518d0a4ec749593df574f7597a36140',
  '0x34cb0eb1c048055e8a9081cbc59e1646111fb854',
  '0x473d3a2005499301dc353afa9d0c9c5980b5188c',
  '0x8f97684760409ff1ffd46bc3c79237b942605b0b',
  '0x34769a3655ea6128357093b86996860074a901fb',
  '0xaaf6e91c84f044ccae6386db08ba6a162818e710',
  '0xebf0fb688453698c155e5ef9e5b5ce3995d69e53',
  '0x1296db4075cc43c3292b51b1929f41eca0fa6544',
  '0x13bc8d1c7a2b08cdb1f9ee4560e1e903c0c092d9',
  '0xadc8aaddf5dcf81366fcc0212c154dfbfde1ed13',
  '0xb44073b720c8a155a0024d16aee1574fc371b2fc',
];

async function main() {
  console.log('\n============================================================');
  console.log('IMPORT $10K+ BRIDGERS');
  console.log('============================================================\n');
  
  console.log(`Total bridgers to import: ${BRIDGERS.length}`);
  
  // Batch insert into trader_quality
  console.log('\nInserting into trader_quality...');
  
  const records = BRIDGERS.map(address => ({
    address: address.toLowerCase(),
    quality_tier: 'unanalyzed',
    is_tracked: false,
  }));
  
  // Insert in one batch (only 81 records)
  const { data, error } = await supabase
    .from('trader_quality')
    .upsert(records, { 
      onConflict: 'address',
      ignoreDuplicates: true 
    });
  
  if (error) {
    console.log(`Error (may be duplicates): ${error.message}`);
  }
  
  console.log(`Processed ${BRIDGERS.length} bridgers`);
  
  // Also add to hype_holders so they get picked up
  console.log('\nAdding to hype_holders...');
  
  const holderRecords = BRIDGERS.map(address => ({
    address: address.toLowerCase(),
    hype_balance: 0, // Unknown, but they bridged $10k+
  }));
  
  const { error: holderError } = await supabase
    .from('hype_holders')
    .upsert(holderRecords, { 
      onConflict: 'address',
      ignoreDuplicates: true 
    });
  
  if (holderError) {
    console.log(`Holder error (may be duplicates): ${holderError.message}`);
  }
  
  console.log('\n============================================================');
  console.log('IMPORT COMPLETE');
  console.log('============================================================');
  console.log(`\nImported: ${BRIDGERS.length} bridgers`);
  console.log('\nNext step: Run analyzer to evaluate them');
  console.log('  npm run analyze');
  console.log('');
  
  process.exit(0);
}

main().catch(console.error);