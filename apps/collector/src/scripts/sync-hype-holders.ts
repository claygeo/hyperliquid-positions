// HYPE Holder Sync - Fetches holders from Hypurrscan and stores in database
// Run manually: npx ts-node src/scripts/sync-hype-holders.ts

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';

const logger = createLogger('hype-sync');

interface HypurrscanResponse {
  token: string;
  lastUpdate: number;
  holdersCount: number;
  holders: Record<string, number>;
  length: number;
}

interface HypeHolder {
  address: string;
  balance: number;
}

async function fetchHypeHolders(): Promise<HypeHolder[]> {
  logger.info('Fetching HYPE holders from Hypurrscan...');
  
  try {
    const response = await fetch(config.hypurrscan.holdersApi);
    
    if (!response.ok) {
      throw new Error(`Hypurrscan API error: ${response.status}`);
    }
    
    const data = await response.json() as HypurrscanResponse;
    
    logger.info(`Received ${data.length} holders from API (total: ${data.holdersCount})`);
    
    // Convert holders object to array
    const holders: HypeHolder[] = Object.entries(data.holders).map(([address, balance]) => ({
      address: address.toLowerCase(),
      balance: balance,
    }));
    
    // Filter by minimum balance
    const filtered = holders.filter(h => h.balance >= config.holders.minHypeBalance);
    
    logger.info(`Filtered to ${filtered.length} holders with >= ${config.holders.minHypeBalance} HYPE`);
    
    return filtered;
  } catch (error) {
    logger.error('Failed to fetch HYPE holders', error);
    throw error;
  }
}

async function storeHolders(holders: HypeHolder[]): Promise<void> {
  logger.info(`Storing ${holders.length} holders in database...`);
  
  // Log sync start
  const syncLog = await db.client
    .from('sync_log')
    .insert({
      operation: 'hype_holder_sync',
      status: 'started',
      details: { total_holders: holders.length },
    })
    .select('id')
    .single();
  
  const syncId = syncLog.data?.id;
  
  try {
    // Process in batches
    const batchSize = 100;
    let inserted = 0;
    let updated = 0;
    
    for (let i = 0; i < holders.length; i += batchSize) {
      const batch = holders.slice(i, i + batchSize);
      
      const records = batch.map(h => ({
        address: h.address,
        hype_balance: h.balance,
        updated_at: new Date().toISOString(),
      }));
      
      const result = await db.client
        .from('hype_holders')
        .upsert(records, { 
          onConflict: 'address',
          ignoreDuplicates: false,
        });
      
      if (result.error) {
        logger.error(`Batch insert error: ${result.error.message}`);
      } else {
        inserted += batch.length;
      }
      
      // Progress log
      if ((i + batchSize) % 500 === 0 || i + batchSize >= holders.length) {
        logger.info(`Progress: ${Math.min(i + batchSize, holders.length)}/${holders.length}`);
      }
    }
    
    // Update sync log
    await db.client
      .from('sync_log')
      .update({
        status: 'completed',
        details: { total_holders: holders.length, inserted },
        completed_at: new Date().toISOString(),
      })
      .eq('id', syncId);
    
    logger.info(`Sync complete: ${inserted} holders stored`);
    
  } catch (error) {
    // Update sync log with failure
    await db.client
      .from('sync_log')
      .update({
        status: 'failed',
        details: { error: String(error) },
        completed_at: new Date().toISOString(),
      })
      .eq('id', syncId);
    
    throw error;
  }
}

async function createQualityRecords(): Promise<void> {
  logger.info('Creating trader_quality records for new holders...');
  
  // Insert trader_quality records for holders that don't have one
  const result = await db.client.rpc('exec_sql', {
    sql: `
      INSERT INTO trader_quality (address)
      SELECT h.address 
      FROM hype_holders h
      LEFT JOIN trader_quality q ON h.address = q.address
      WHERE q.address IS NULL
    `
  });
  
  // Alternative approach if RPC doesn't work
  const holders = await db.client
    .from('hype_holders')
    .select('address');
  
  if (holders.data) {
    const existing = await db.client
      .from('trader_quality')
      .select('address');
    
    const existingSet = new Set((existing.data || []).map((r: { address: string }) => r.address));
    const newHolders = holders.data.filter((h: { address: string }) => !existingSet.has(h.address));
    
    if (newHolders.length > 0) {
      // Insert in batches
      const batchSize = 100;
      for (let i = 0; i < newHolders.length; i += batchSize) {
        const batch = newHolders.slice(i, i + batchSize);
        await db.client
          .from('trader_quality')
          .insert(batch.map((h: { address: string }) => ({ address: h.address })));
      }
      
      logger.info(`Created ${newHolders.length} new trader_quality records`);
    }
  }
}

async function main(): Promise<void> {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('HYPE HOLDER SYNC');
  logger.info('='.repeat(60));
  logger.info('');
  
  // Validate environment
  if (!process.env.SUPABASE_URL) {
    logger.error('Missing SUPABASE_URL');
    process.exit(1);
  }
  
  if (!process.env.SUPABASE_SERVICE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.error('Missing SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  
  try {
    // Step 1: Fetch holders
    const holders = await fetchHypeHolders();
    
    // Step 2: Store in database
    await storeHolders(holders);
    
    // Step 3: Create quality records
    await createQualityRecords();
    
    // Summary
    logger.info('');
    logger.info('='.repeat(60));
    logger.info('SYNC COMPLETE');
    logger.info('='.repeat(60));
    logger.info(`Total holders stored: ${holders.length}`);
    logger.info('');
    logger.info('Next step: Run PnL analyzer to classify traders');
    logger.info('  npx ts-node src/scripts/analyze-traders.ts');
    logger.info('');
    
    process.exit(0);
    
  } catch (error) {
    logger.error('Sync failed', error);
    process.exit(1);
  }
}

main();