// Analyze Traders Script - Processes ALL unanalyzed HYPE holders
// Run: npm run analyze

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createLogger } from '../utils/logger.js';
import { analyzeTrader, saveTraderAnalysis, getQualityStats } from '../processors/pnl-analyzer.js';
import db from '../db/client.js';
import { config } from '../config.js';

const logger = createLogger('analyze-script');

async function getUnanalyzedHolders(): Promise<{ address: string }[]> {
  // Get holders that either:
  // 1. Don't have a trader_quality record yet, OR
  // 2. Have analyzed_at = NULL (never been analyzed)
  
  const allHolders: { address: string }[] = [];
  let offset = 0;
  const batchSize = 1000;
  
  // Paginate through all holders (Supabase defaults to 1000 limit)
  while (true) {
    const result = await db.client
      .from('hype_holders')
      .select('address')
      .order('hype_balance', { ascending: false })
      .range(offset, offset + batchSize - 1);
    
    if (result.error || !result.data || result.data.length === 0) {
      break;
    }
    
    allHolders.push(...result.data);
    
    if (result.data.length < batchSize) {
      break; // Last page
    }
    
    offset += batchSize;
  }
  
  logger.info(`Total holders in database: ${allHolders.length}`);
  
  // Check which ones are already analyzed (paginate to avoid 1000 row limit)
  const analyzedAddresses: string[] = [];
  offset = 0;
  
  while (true) {
    const result = await db.client
      .from('trader_quality')
      .select('address')
      .not('analyzed_at', 'is', null)
      .range(offset, offset + batchSize - 1);
    
    if (result.error || !result.data || result.data.length === 0) {
      break;
    }
    
    analyzedAddresses.push(...result.data.map((r: { address: string }) => r.address));
    
    if (result.data.length < batchSize) {
      break;
    }
    
    offset += batchSize;
  }
  
  const analyzedSet = new Set(analyzedAddresses);
  const unanalyzed = allHolders.filter(h => !analyzedSet.has(h.address));
  
  logger.info(`Already analyzed: ${analyzedSet.size}`);
  logger.info(`Remaining to analyze: ${unanalyzed.length}`);
  
  return unanalyzed;
}

async function main(): Promise<void> {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('TRADER ANALYSIS - FULL RUN');
  logger.info('='.repeat(60));
  logger.info('');
  
  const startTime = Date.now();
  
  try {
    // Get initial stats
    const initialStats = await getQualityStats();
    logger.info(`Current stats: ${initialStats.elite} Elite | ${initialStats.good} Good | ${initialStats.tracked} Tracked`);
    logger.info('');
    
    // Get unanalyzed holders
    const holders = await getUnanalyzedHolders();
    
    if (holders.length === 0) {
      logger.info('All holders have been analyzed!');
      logger.info('');
      const stats = await getQualityStats();
      logger.info(`Final stats: ${stats.elite} Elite | ${stats.good} Good | ${stats.tracked} Tracked`);
      process.exit(0);
    }
    
    logger.info('');
    logger.info(`Starting analysis of ${holders.length} holders...`);
    logger.info('');
    
    let analyzed = 0;
    let elite = 0;
    let good = 0;
    let weak = 0;
    let skipped = 0;
    
    // Process in batches
    for (let i = 0; i < holders.length; i += config.analysis.batchSize) {
      const batch = holders.slice(i, i + config.analysis.batchSize);
      
      // Analyze batch concurrently
      const results = await Promise.all(
        batch.map(h => analyzeTrader(h.address))
      );
      
      // Save results
      for (const analysis of results) {
        if (analysis) {
          await saveTraderAnalysis(analysis);
          analyzed++;
          
          if (analysis.quality_tier === 'elite') elite++;
          else if (analysis.quality_tier === 'good') good++;
          else weak++;
        } else {
          skipped++;
        }
      }
      
      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, config.analysis.batchDelayMs));
      
      // Log progress every 100
      const progress = i + batch.length;
      if (progress % 100 === 0 || progress >= holders.length) {
        const pct = Math.round((progress / holders.length) * 100);
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const rate = Math.round(progress / elapsed * 60); // per minute
        const remaining = Math.round((holders.length - progress) / rate);
        
        logger.info(
          `Progress: ${progress}/${holders.length} (${pct}%) | ` +
          `Elite: ${elite}, Good: ${good}, Weak: ${weak} | ` +
          `~${remaining}m remaining`
        );
      }
    }
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    // Final stats
    const finalStats = await getQualityStats();
    
    logger.info('');
    logger.info('='.repeat(60));
    logger.info('ANALYSIS COMPLETE');
    logger.info('='.repeat(60));
    logger.info(`Duration: ${Math.floor(duration / 60)}m ${duration % 60}s`);
    logger.info(`Analyzed: ${analyzed} | Skipped: ${skipped}`);
    logger.info('');
    logger.info('This run found:');
    logger.info(`  Elite:   +${elite}`);
    logger.info(`  Good:    +${good}`);
    logger.info(`  Weak:    +${weak}`);
    logger.info('');
    logger.info('Total quality traders:');
    logger.info(`  Elite:   ${finalStats.elite}`);
    logger.info(`  Good:    ${finalStats.good}`);
    logger.info(`  Tracked: ${finalStats.tracked}`);
    logger.info('');
    logger.info('Render will automatically pick up new traders!');
    logger.info('');
    
    process.exit(0);
    
  } catch (error) {
    logger.error('Analysis failed', error);
    process.exit(1);
  }
}

main();