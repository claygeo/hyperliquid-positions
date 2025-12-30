// Trader Re-evaluation V3
// - Weekly full re-evaluation of all tracked traders
// - Demotion/promotion logic based on recent performance
// - Historical performance tracking
// - Can be run manually or on a schedule

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import { analyzeTrader, saveTraderAnalysis } from './pnl-analyzer.js';

const logger = createLogger('trader-reeval');

// ============================================
// Types
// ============================================

interface TraderHistoryEntry {
  address: string;
  pnl_7d: number;
  pnl_30d: number;
  win_rate: number;
  profit_factor: number;
  trades_30d: number;
  quality_score: number;
  quality_tier: string;
  previous_tier: string | null;
  tier_changed: boolean;
  change_reason: string;
}

interface ReEvalStats {
  totalEvaluated: number;
  promoted: number;
  demoted: number;
  maintained: number;
  newElite: number;
  newGood: number;
  removedFromTracking: number;
}

// ============================================
// Core Re-evaluation Logic
// ============================================

/**
 * Check if elite trader should be demoted
 */
function shouldDemoteElite(trader: { pnl_7d?: number; win_rate?: number; profit_factor?: number }): { demote: boolean; reason: string } {
  const { demoteEliteIf } = config.reeval;
  
  if ((trader.pnl_7d || 0) < demoteEliteIf.pnl7dBelow) {
    return { demote: true, reason: `7d PnL below $${demoteEliteIf.pnl7dBelow}` };
  }
  
  if ((trader.win_rate || 0) < demoteEliteIf.winRateBelow) {
    return { demote: true, reason: `Win rate below ${(demoteEliteIf.winRateBelow * 100).toFixed(0)}%` };
  }
  
  if ((trader.profit_factor || 0) < demoteEliteIf.profitFactorBelow) {
    return { demote: true, reason: `Profit factor below ${demoteEliteIf.profitFactorBelow}` };
  }
  
  return { demote: false, reason: '' };
}

/**
 * Check if good trader should be demoted
 */
function shouldDemoteGood(trader: { pnl_7d?: number; win_rate?: number }): { demote: boolean; reason: string } {
  const { demoteGoodIf } = config.reeval;
  
  if ((trader.pnl_7d || 0) < demoteGoodIf.pnl7dBelow) {
    return { demote: true, reason: `7d PnL below $${demoteGoodIf.pnl7dBelow}` };
  }
  
  if ((trader.win_rate || 0) < demoteGoodIf.winRateBelow) {
    return { demote: true, reason: `Win rate below ${(demoteGoodIf.winRateBelow * 100).toFixed(0)}%` };
  }
  
  return { demote: false, reason: '' };
}

/**
 * Save trader history snapshot
 */
async function saveTraderHistory(entry: TraderHistoryEntry): Promise<void> {
  try {
    await db.client
      .from('trader_performance_history')
      .insert({
        address: entry.address,
        pnl_7d: entry.pnl_7d,
        pnl_30d: entry.pnl_30d,
        win_rate: entry.win_rate,
        profit_factor: entry.profit_factor,
        trades_30d: entry.trades_30d,
        quality_score: entry.quality_score,
        quality_tier: entry.quality_tier,
        previous_tier: entry.previous_tier,
        tier_changed: entry.tier_changed,
        change_reason: entry.change_reason,
        snapshot_at: new Date().toISOString(),
      });
  } catch (error) {
    logger.error(`Failed to save history for ${entry.address}`, error);
  }
}

/**
 * Update trader tier change tracking
 */
async function updateTierChangeTracking(
  address: string,
  newTier: string,
  previousTier: string
): Promise<void> {
  if (newTier === previousTier) return;
  
  try {
    // Get current tier change count
    const { data: trader } = await db.client
      .from('trader_quality')
      .select('tier_change_count')
      .eq('address', address)
      .single();
    
    await db.client
      .from('trader_quality')
      .update({
        tier_change_count: ((trader?.tier_change_count as number) || 0) + 1,
        last_tier_change_at: new Date().toISOString(),
      })
      .eq('address', address);
  } catch (error) {
    logger.error(`Failed to update tier tracking for ${address}`, error);
  }
}

// ============================================
// Main Re-evaluation Function
// ============================================

/**
 * Run full re-evaluation of all tracked traders
 */
export async function reEvaluateAllTraders(): Promise<ReEvalStats> {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('TRADER RE-EVALUATION');
  logger.info('='.repeat(60));
  logger.info('');
  
  const stats: ReEvalStats = {
    totalEvaluated: 0,
    promoted: 0,
    demoted: 0,
    maintained: 0,
    newElite: 0,
    newGood: 0,
    removedFromTracking: 0,
  };
  
  try {
    // Get all currently tracked traders
    const { data: trackedTraders, error } = await db.client
      .from('trader_quality')
      .select('*')
      .eq('is_tracked', true)
      .in('quality_tier', ['elite', 'good']);
    
    if (error || !trackedTraders) {
      logger.error('Failed to get tracked traders', error);
      return stats;
    }
    
    logger.info(`Evaluating ${trackedTraders.length} tracked traders...`);
    logger.info('');
    
    for (const trader of trackedTraders) {
      stats.totalEvaluated++;
      const previousTier = trader.quality_tier as string;
      
      // Re-analyze trader with fresh data
      const analysis = await analyzeTrader(trader.address);
      
      if (!analysis) {
        // Couldn't analyze - might have no recent trades
        logger.warn(`${trader.address.slice(0, 10)}... - Could not analyze, removing from tracking`);
        
        await db.client
          .from('trader_quality')
          .update({ 
            is_tracked: false,
            quality_tier: 'inactive'
          })
          .eq('address', trader.address);
        
        stats.removedFromTracking++;
        
        await saveTraderHistory({
          address: trader.address,
          pnl_7d: 0,
          pnl_30d: 0,
          win_rate: 0,
          profit_factor: 0,
          trades_30d: 0,
          quality_score: 0,
          quality_tier: 'inactive',
          previous_tier: previousTier,
          tier_changed: true,
          change_reason: 'no_recent_activity',
        });
        
        continue;
      }
      
      // Check for demotion based on strict rules
      let finalTier = analysis.quality_tier;
      let changeReason = 'maintained';
      
      if (previousTier === 'elite') {
        const { demote, reason } = shouldDemoteElite(analysis);
        if (demote) {
          // Check if they still qualify as good
          if (analysis.quality_tier === 'good') {
            finalTier = 'good';
            changeReason = `demoted: ${reason}`;
            stats.demoted++;
            logger.info(`⬇️  ${trader.address.slice(0, 10)}... ELITE → GOOD: ${reason}`);
          } else {
            finalTier = 'weak';
            changeReason = `demoted: ${reason}`;
            stats.demoted++;
            stats.removedFromTracking++;
            logger.info(`⬇️  ${trader.address.slice(0, 10)}... ELITE → WEAK: ${reason}`);
          }
        } else if (analysis.quality_tier === 'elite') {
          stats.maintained++;
        }
      } else if (previousTier === 'good') {
        const { demote, reason } = shouldDemoteGood(analysis);
        if (demote) {
          finalTier = 'weak';
          changeReason = `demoted: ${reason}`;
          stats.demoted++;
          stats.removedFromTracking++;
          logger.info(`⬇️  ${trader.address.slice(0, 10)}... GOOD → WEAK: ${reason}`);
        } else if (analysis.quality_tier === 'elite') {
          // Promotion!
          finalTier = 'elite';
          changeReason = 'promoted: met elite criteria';
          stats.promoted++;
          stats.newElite++;
          logger.info(`⬆️  ${trader.address.slice(0, 10)}... GOOD → ELITE: Met elite criteria!`);
        } else {
          stats.maintained++;
        }
      }
      
      // Determine if still tracked
      const isTracked = finalTier === 'elite' || finalTier === 'good';
      
      // Update the analysis object for saving
      const updatedAnalysis = {
        ...analysis,
        quality_tier: finalTier,
      };
      
      // Save the updated analysis
      await saveTraderAnalysis(updatedAnalysis);
      
      // Also update is_tracked separately since it might not be in the analysis
      await db.client
        .from('trader_quality')
        .update({ is_tracked: isTracked })
        .eq('address', trader.address);
      
      // Update tier change tracking
      await updateTierChangeTracking(trader.address, finalTier, previousTier);
      
      // Save history entry
      await saveTraderHistory({
        address: trader.address,
        pnl_7d: analysis.pnl_7d,
        pnl_30d: analysis.pnl_30d || 0,
        win_rate: analysis.win_rate,
        profit_factor: analysis.profit_factor || 1,
        trades_30d: analysis.trades_30d || 0,
        quality_score: analysis.quality_score,
        quality_tier: finalTier,
        previous_tier: previousTier,
        tier_changed: finalTier !== previousTier,
        change_reason: changeReason,
      });
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Also check for any new traders that might qualify
    logger.info('');
    logger.info('Checking for newly qualified traders...');
    
    const { data: potentialTraders } = await db.client
      .from('trader_quality')
      .select('address')
      .eq('quality_tier', 'weak')
      .gt('analyzed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(50);
    
    if (potentialTraders && potentialTraders.length > 0) {
      for (const potential of potentialTraders) {
        const analysis = await analyzeTrader(potential.address);
        
        if (analysis && (analysis.quality_tier === 'elite' || analysis.quality_tier === 'good')) {
          await saveTraderAnalysis(analysis);
          
          // Also update is_tracked
          await db.client
            .from('trader_quality')
            .update({ is_tracked: true })
            .eq('address', potential.address);
          
          if (analysis.quality_tier === 'elite') {
            stats.newElite++;
            logger.info(`🆕 ${potential.address.slice(0, 10)}... NEW ELITE`);
          } else {
            stats.newGood++;
            logger.info(`🆕 ${potential.address.slice(0, 10)}... NEW GOOD`);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    // Log summary
    logger.info('');
    logger.info('='.repeat(60));
    logger.info('RE-EVALUATION COMPLETE');
    logger.info('='.repeat(60));
    logger.info(`Total evaluated: ${stats.totalEvaluated}`);
    logger.info(`Promoted: ${stats.promoted}`);
    logger.info(`Demoted: ${stats.demoted}`);
    logger.info(`Maintained: ${stats.maintained}`);
    logger.info(`Removed from tracking: ${stats.removedFromTracking}`);
    logger.info(`New Elite: ${stats.newElite}`);
    logger.info(`New Good: ${stats.newGood}`);
    logger.info('');
    
  } catch (error) {
    logger.error('Re-evaluation failed', error);
  }
  
  return stats;
}

/**
 * Clean up old history entries
 */
export async function cleanupOldHistory(): Promise<void> {
  try {
    const cutoffDate = new Date(Date.now() - config.reeval.keepHistoryDays * 24 * 60 * 60 * 1000);
    
    const { error } = await db.client
      .from('trader_performance_history')
      .delete()
      .lt('snapshot_at', cutoffDate.toISOString());
    
    if (error) {
      logger.error('Failed to cleanup old history', error);
    } else {
      logger.info(`Cleaned up history older than ${config.reeval.keepHistoryDays} days`);
    }
  } catch (error) {
    logger.error('History cleanup failed', error);
  }
}

/**
 * Get trader history
 */
export async function getTraderHistory(address: string, limit: number = 10): Promise<unknown[]> {
  const { data } = await db.client
    .from('trader_performance_history')
    .select('*')
    .eq('address', address)
    .order('snapshot_at', { ascending: false })
    .limit(limit);
  
  return data || [];
}

/**
 * Get traders with most tier changes (volatile performers)
 */
export async function getVolatileTraders(limit: number = 10): Promise<unknown[]> {
  const { data } = await db.client
    .from('trader_quality')
    .select('address, quality_tier, tier_change_count, pnl_7d, win_rate')
    .gt('tier_change_count', 0)
    .order('tier_change_count', { ascending: false })
    .limit(limit);
  
  return data || [];
}