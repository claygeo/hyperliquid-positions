// Import Bridgers ($25k+) - Add to hype_holders FIRST, then trader_quality
// Run with: npx tsx src/scripts/import-bridgers-25k.ts

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// 73 wallets that bridged $25k+ to Hyperliquid
const BRIDGERS = [
  '0xeaafc116a53d1592b8245fbae5205eafdc2597ec',
  '0xda69769af9335a5b3c1736bee42c8c167d13d907',
  '0xea3f8f9c47b215be864c793a106b60f67096296c',
  '0x36895e9f477488d500da96d8b4e6066005d0f45c',
  '0x43c89407960a524cb8c6ce09d647423fcecc40c6',
  '0x4c62afc2b85181b356142a4a65fbfddcea765e93',
  '0x6871c11bf0d2ab2d29bb1a1d0e5d7d011735579a',
  '0xf032648dfd22c4d81588bd83e09ab89cfe816705',
  '0x3a6565f7664eeceb6cd8220944759fd4826ed610',
  '0xabe1b8ffbeed715fe584ba3e4e90c91bcfcf35d0',
  '0x118ce6448339baaf86841fee7ba674e01b2856d5',
  '0x06b1525af6ade8158f6a0a09564dfc95e193d3c9',
  '0x5989babb0b91393f4ec49d66b9f5e07ae82db6f1',
  '0x72aa58d187662084067cedc12ca221fedbe9293e',
  '0xd2cacb83b8bbbd87c6e8d14abe7ff669d79e9726',
  '0xd476c0ef7fca513afd795df9f2f089244b72e3fe',
  '0x9080c3570a838a482f23b4906751e1b286fc25f6',
  '0xdf196899f90c7df72ccb300835174d7600d01e03',
  '0x229ec9d6010f9a38307320ed34318eaf214d9aab',
  '0xc49d2d453bb467ae4cf7d60109774cb8ec1fd1dd',
  '0x2bfa571fb3c65d0147c0b2c9b38d56201096095d',
  '0x86765b4dc96ae4c81a08c8ab742f537a15a739d2',
  '0xdf065464c26124ca2113d1dff700c89178a3759f',
  '0x870e894c60e79311400235987718c0fb086f585a',
  '0xa9855d9f23f3856f917acde659ab6e8ae8c5d678',
  '0x2abf85fa356ee211d4e86b81e8ec06787c6d6bf8',
  '0x6ea3c2e9050649954a4cfdcee3e3d2034b0ebe38',
  '0x811f5f709477cd38d5e33c05084294539e484236',
  '0x3f973e7dab2e5acbc33ae4d1b32f3873517e08d8',
  '0x000461a73d3985eef4923655782aa5d0de75c111',
  '0xc171e3116fec4f3683ee14bf44c0dfdfacae9ab8',
  '0x01fbaf59e3f78f747a648d7b70bc6d468bc55185',
  '0xc40137181d7d7e61a2098673000c4b4494b06785',
  '0x017e887cf1c3227d08eac47a45abc765955ae114',
  '0xee9495f6f6ee548c6d441c366a7021a7befc4acf',
  '0x7ca16e653873af9993a7bfc4334a6ef7c31eeeb8',
  '0xb15acd43df97e72c07d41164e2e9f15639e8573d',
  '0x2b2ac0210dbab673063074abe205ec6bf62aee86',
  '0xb125eaac3504eea82ba3df60e95ccea1b482ddf5',
  '0xab1e737f13817147a74f6642001f28d6dd7de242',
  '0x1d888a88fe88491fd653a107198894c8b59249eb',
  '0xb44073b720c8a155a0024d16aee1574fc371b2fc',
  '0x1b14f899b1bc22add6df45da3a3423f5ceed8480',
  '0xadc8aaddf5dcf81366fcc0212c154dfbfde1ed13',
  '0x48e409d8d5700ec9b390b6164effc3266b0fae31',
  '0xb05e78d739917f1581dd5775d4fc42f8d6165847',
  '0x677b55b428ad095c10ec121dd1389cfc6c48f0b7',
  '0x26bbf336f851d259d687f517d8e65a8bf7a9e349',
  '0xf388d9a77b3b9c9e5c8018168da0b1404ed4d328',
  '0x196313fb2df7ac913bb6f4fedef8f434c2b03e6d',
  '0x9447857d86af4078afec6cc65d5f41f098e97f26',
  '0x98d3afaf4f9c24b12ad5f23b44aa1873ffccc9b6',
  '0x7d6fc0ee4aa797e091fb1f67bbb016b0dc5820fe',
  '0x068ba1137ccb10f0392135476ef3b1a12ff3586a',
  '0x8f9a93c10164892582faaa75d8c2e000442b4484',
  '0xc1c94d3677f8876664dd555559ec8f726352dd2d',
  '0x3979bdf742ce46c9dcd570c70d2d6e88b87df0e9',
  '0xd4da65123ef4a70ff8a1e0777ce634d881f99b16',
  '0x6a0d674cdbc9669247223fc1d7e07fc42b9937cd',
  '0x6b79d620f6d14bc4a9d579f2bd06570a794bc2f7',
  '0xf6695567c82db6e2faef7707e6cf3025183b1cad',
  '0x9940048d0a2e62ccf34157161121e9c0ef2faa37',
  '0x3f3dda04cf0baf15d7218b6a1c7e7abb892fef99',
  '0x6b17e9f380c0f991800bef4fd44fe0e3c6f98363',
  '0x0f46573a97a453749cacf3d9436a1e3806441014',
  '0x8f50b637e40e2f80be45fde317c94312f529769f',
  '0x41e345e3e7dd421ed2894ec85cbf1c76766f6752',
  '0x75acd5ef326d88d0db81e5a34d80f800022a5ffd',
  '0x4a96036fb1529561fa3eeeb2781fad2d4f25500e',
  '0xd19d6cf07870773b814aa93e41e3e547771a13a6',
  '0x0c0490be7112022802d0eac9544ad5f6b3d8c75f',
  '0x003be39433bde975b12411fbc3025d49d813a84f',
  '0xbaf2179e73929853b8bf4cc340b3e80bd38adbb5',
];

async function main() {
  console.log('\n============================================================');
  console.log('IMPORT $25K+ BRIDGERS');
  console.log('============================================================\n');
  
  console.log(`Total bridgers to import: ${BRIDGERS.length}`);
  
  // STEP 1: Add to hype_holders FIRST (to satisfy foreign key)
  console.log('\n1. Adding to hype_holders...');
  
  const holderRecords = BRIDGERS.map(address => ({
    address: address.toLowerCase(),
    hype_balance: 0, // Unknown HYPE balance, but bridged $25k+
  }));
  
  const { error: holderError } = await supabase
    .from('hype_holders')
    .upsert(holderRecords, { 
      onConflict: 'address',
      ignoreDuplicates: true 
    });
  
  if (holderError) {
    console.log(`   Error: ${holderError.message}`);
  } else {
    console.log(`   Added ${BRIDGERS.length} to hype_holders`);
  }
  
  // STEP 2: Add to trader_quality
  console.log('\n2. Adding to trader_quality...');
  
  const qualityRecords = BRIDGERS.map(address => ({
    address: address.toLowerCase(),
    quality_tier: 'unanalyzed',
    is_tracked: false,
  }));
  
  const { error: qualityError } = await supabase
    .from('trader_quality')
    .upsert(qualityRecords, { 
      onConflict: 'address',
      ignoreDuplicates: true 
    });
  
  if (qualityError) {
    console.log(`   Error: ${qualityError.message}`);
  } else {
    console.log(`   Added ${BRIDGERS.length} to trader_quality`);
  }
  
  console.log('\n============================================================');
  console.log('IMPORT COMPLETE');
  console.log('============================================================');
  console.log(`\nImported: ${BRIDGERS.length} bridgers ($25k+)`);
  console.log('\nNext step: Run analyzer');
  console.log('  npm run analyze');
  console.log('');
  
  process.exit(0);
}

main().catch(console.error);