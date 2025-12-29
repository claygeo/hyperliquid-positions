// Analyze Traders Script - Run after HYPE holder sync
// Run: npx ts-node src/scripts/analyze-traders.ts

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createLogger } from '../utils/logger.js';
import { analyzeAllTraders, getQualityStats } from '../processors/pnl-analyzer.js';

const logger = createLogger('analyze-script');

async function main(): Promise<void> {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('TRADER ANALYSIS');
  logger.info('='.repeat(60));
  logger.info('');
  
  const startTime = Date.now();
  
  try {
    // Run full analysis
    const results = await analyzeAllTraders((current, total) => {
      // Progress is logged within analyzeAllTraders
    });
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    // Final stats
    const stats = await getQualityStats();
    
    logger.info('');
    logger.info('='.repeat(60));
    logger.info('ANALYSIS COMPLETE');
    logger.info('='.repeat(60));
    logger.info(`Duration: ${duration} seconds`);
    logger.info(`Total analyzed: ${results.analyzed}/${results.total}`);
    logger.info('');
    logger.info('Quality Breakdown:');
    logger.info(`  Elite:   ${results.elite} traders`);
    logger.info(`  Good:    ${results.good} traders`);
    logger.info(`  Weak:    ${results.weak} traders`);
    logger.info('');
    logger.info(`Tracked traders: ${stats.tracked}`);
    logger.info('');
    logger.info('System is ready! Start the collector:');
    logger.info('  npm run start');
    logger.info('');
    
    process.exit(0);
    
  } catch (error) {
    logger.error('Analysis failed', error);
    process.exit(1);
  }
}

main();