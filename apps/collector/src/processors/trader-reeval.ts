// Trader Re-evaluation V5
// Enhanced from V4 with:
// - Sustained unrealized drawdown demotion (>50% for >24 hours = demote)
// - Track unrealized drawdown start time
// - Factor current position health into re-evaluation
// - More nuanced demotion for traders holding underwater positions

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';
import { analyzeTrader, saveTraderAnalysis, TraderAnalysis } from './pnl-analyzer.js';
import hyperliquid from '../utils/hyperliquid-api.js';

const logger = createLogger('trader-reeval-v5');

// ============================================
// Types
// ============================================

interface TraderHistoryEntry {
  address: string;
  pnl_7d: number;
  pnl_30d: number;
  roi_7d_pct: number;
  roi_30d_pct: number;
  win_rate: number;
  profit_factor: number;
  total_trades: number;
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
  demotedForDrawdown: number;
}

interface TraderPositionSummary {
  totalUnrealizedPnl: number;
  totalPositionValue: number;
  unrealizedPnlPct: number;
  worstPositionPct: number;
  positionCount: number;
}

// ============================================
// V5: Unrealized Drawdown Functions
// ============================================

/**
 * Get current unrealized P&L across all positions for a trader
 */
async function getTraderUnrealizedPnl(address: string): Promise<TraderPositionSummary | null> {
  try {
    const { data: positions, error } = await db.client
      .from('trader_positions')
      .select('unrealized_pnl, value_usd')
      .eq('address', address.toLowerCase());
    
    if (error || !positions || positions.length === 0) {
      return null;
    }
    
    let totalUnrealizedPnl = 0;
    let totalPositionValue = 0;
    let worstPositionPct = 0;
    
    for (const pos of positions) {
      const unrealizedPnl = parseFloat(pos.unrealized_pnl) || 0;
      const valueUsd = parseFloat(pos.value_usd) || 0;
      
      totalUnrealizedPnl += unrealizedPnl;
      totalPositionValue += valueUsd;
      
      // Track worst individual position
      if (valueUsd > 0) {
        const posPct = (unrealizedPnl / valueUsd) * 100;
        if (posPct < worstPositionPct) {
          worstPositionPct = posPct;
        }
      }
    }
    
    const unrealizedPnlPct = totalPositionValue > 0 
      ? (totalUnrealizedPnl / totalPositionValue) * 100 
      : 0;
    
    return {
      totalUnrealizedPnl,
      totalPositionValue,
      unrealizedPnlPct,
      worstPositionPct,
      positionCount: positions.length,
    };
  } catch (err) {
    logger.error(`Failed to get unrealized P&L for ${address}`, err);
    return null;
  }
}

/**
 * Update unrealized drawdown tracking in database
 */
async function updateUnrealizedDrawdownTracking(
  address: string,
  currentDrawdownPct: number
): Promise<void> {
  try {
    const { data: trader } = await db.client
      .from('trader_quality')
      .select('max_unrealized_drawdown_pct, unrealized_drawdown_since')
      .eq('address', address.toLowerCase())
      .single();
    
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      current_unrealized_pnl_pct: -currentDrawdownPct, // Store as negative since it's a loss
    };
    
    // If currently in drawdown
    if (currentDrawdownPct > 0) {
      // Update max if this is worse
      if (!trader?.max_unrealized_drawdown_pct || currentDrawdownPct > trader.max_unrealized_drawdown_pct) {
        updates.max_unrealized_drawdown_pct = currentDrawdownPct;
      }
      
      // Start tracking if not already
      if (!trader?.unrealized_drawdown_since) {
        updates.unrealized_drawdown_since = now;
        logger.debug(`${address.slice(0, 10)}... started drawdown tracking at ${currentDrawdownPct.toFixed(1)}%`);
      }
    } else {
      // No longer in drawdown, reset tracking
      updates.unrealized_drawdown_since = null;
      // Keep max_unrealized_drawdown_pct for historical reference
    }
    
    await db.client
      .from('trader_quality')
      .update(updates)
      .eq('address', address.toLowerCase());
      
  } catch (err) {
    logger.error(`Failed to update drawdown tracking for ${address}`, err);
  }
}

/**
 * Check if trader should be demoted due to sustained unrealized drawdown
 */
async function shouldDemoteForSustainedDrawdown(
  address: string,
  currentDrawdownPct: number
): Promise<{ demote: boolean; reason: string }> {
  try {
    const { data: trader } = await db.client
      .from('trader_quality')
      .select('unrealized_drawdown_since, quality_tier')
      .eq('address', address.toLowerCase())
      .single();
    
    if (!trader) {
      return { demote: false, reason: '' };
    }
    
    // V5: Demotion thresholds
    const SEVERE_DRAWDOWN_PCT = 50;   // Severe drawdown threshold
    const SUSTAINED_HOURS = 24;       // How long before demotion
    const CRITICAL_DRAWDOWN_PCT = 75; // Immediate demotion threshold
    
    // Critical drawdown = immediate demotion
    if (currentDrawdownPct >= CRITICAL_DRAWDOWN_PCT) {
      return { 
        demote: true, 
        reason: `critical unrealized drawdown: -${currentDrawdownPct.toFixed(0)}%` 
      };
    }
    
    // Severe sustained drawdown
    if (currentDrawdownPct >= SEVERE_DRAWDOWN_PCT && trader.unrealized_drawdown_since) {
      const drawdownStart = new Date(trader.unrealized_drawdown_since).getTime();
      const hoursInDrawdown = (Date.now() - drawdownStart) / (1000 * 60 * 60);
      
      if (hoursInDrawdown >= SUSTAINED_HOURS) {
        return { 
          demote: true, 
          reason: `sustained ${currentDrawdownPct.toFixed(0)}% drawdown for ${hoursInDrawdown.toFixed(0)}h` 
        };
      }
      
      logger.debug(
        `${address.slice(0, 10)}... in ${currentDrawdownPct.toFixed(0)}% drawdown for ${hoursInDrawdown.toFixed(1)}h ` +
        `(demote at ${SUSTAINED_HOURS}h)`
      );
    }
    
    return { demote: false, reason: '' };
  } catch (err) {
    logger.error(`Failed to check sustained drawdown for ${address}`, err);
    return { demote: false, reason: '' };
  }
}

// ============================================
// Core Re-evaluation Logic
// ============================================

/**
 * Check if elite trader should be demoted (V5: includes unrealized drawdown)
 */
function shouldDemoteElite(trader: TraderAnalysis): { demote: boolean; reason: string } {
  const { demoteEliteIf } = config.reeval;
  
  // Check absolute PnL
  if (trader.pnl_7d < demoteEliteIf.pnl7dBelow) {
    return { demote: true, reason: `7d PnL $${trader.pnl_7d.toFixed(0)} below $${demoteEliteIf.pnl7dBelow}` };
  }
  
  // Check ROI% if threshold exists
  if (demoteEliteIf.roi7dBelow !== undefined && trader.roi_7d_pct < demoteEliteIf.roi7dBelow) {
    return { demote: true, reason: `7d ROI ${trader.roi_7d_pct.toFixed(1)}% below ${demoteEliteIf.roi7dBelow}%` };
  }
  
  // Check win rate
  if (trader.win_rate < demoteEliteIf.winRateBelow) {
    return { demote: true, reason: `Win rate ${(trader.win_rate * 100).toFixed(0)}% below ${(demoteEliteIf.winRateBelow * 100).toFixed(0)}%` };
  }
  
  // Check profit factor
  if (trader.profit_factor < demoteEliteIf.profitFactorBelow) {
    return { demote: true, reason: `Profit factor ${trader.profit_factor.toFixed(2)} below ${demoteEliteIf.profitFactorBelow}` };
  }
  
  return { demote: false, reason: '' };
}

/**
 * Check if good trader should be demoted
 */
function shouldDemoteGood(trader: TraderAnalysis): { demote: boolean; reason: string } {
  const { demoteGoodIf } = config.reeval;
  
  // Check absolute PnL
  if (trader.pnl_7d < demoteGoodIf.pnl7dBelow) {
    return { demote: true, reason: `7d PnL $${trader.pnl_7d.toFixed(0)} below $${demoteGoodIf.pnl7dBelow}` };
  }
  
  // Check ROI% if threshold exists
  if (demoteGoodIf.roi7dBelow !== undefined && trader.roi_7d_pct < demoteGoodIf.roi7dBelow) {
    return { demote: true, reason: `7d ROI ${trader.roi_7d_pct.toFixed(1)}% below ${demoteGoodIf.roi7dBelow}%` };
  }
  
  // Check win rate
  if (trader.win_rate < demoteGoodIf.winRateBelow) {
    return { demote: true, reason: `Win rate ${(trader.win_rate * 100).toFixed(0)}% below ${(demoteGoodIf.winRateBelow * 100).toFixed(0)}%` };
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
        roi_7d_pct: entry.roi_7d_pct,
        roi_30d_pct: entry.roi_30d_pct,
        win_rate: entry.win_rate,
        profit_factor: entry.profit_factor,
        total_trades: entry.total_trades,
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
 * Run full re-evaluation of all tracked traders (V5)
 */
export async function reEvaluateAllTraders(): Promise<ReEvalStats> {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('TRADER RE-EVALUATION V5');
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
    demotedForDrawdown: 0,
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
      
      // ============================================
      // V5: Check unrealized drawdown FIRST
      // ============================================
      const unrealizedSummary = await getTraderUnrealizedPnl(trader.address);
      let demotedByDrawdown = false;
      
      if (unrealizedSummary) {
        const currentDrawdownPct = unrealizedSummary.unrealizedPnlPct < 0 
          ? Math.abs(unrealizedSummary.unrealizedPnlPct) 
          : 0;
        
        // Update tracking
        await updateUnrealizedDrawdownTracking(trader.address, currentDrawdownPct);
        
        // Check if should demote for sustained drawdown
        const { demote, reason } = await shouldDemoteForSustainedDrawdown(
          trader.address,
          currentDrawdownPct
        );
        
        if (demote) {
          // Demote directly due to sustained unrealized loss
          const newTier = previousTier === 'elite' ? 'good' : 'weak';
          const isTracked = newTier !== 'weak';
          
          await db.client
            .from('trader_quality')
            .update({
              quality_tier: newTier,
              is_tracked: isTracked,
            })
            .eq('address', trader.address);
          
          await updateTierChangeTracking(trader.address, newTier, previousTier);
          
          await saveTraderHistory({
            address: trader.address,
            pnl_7d: trader.pnl_7d || 0,
            pnl_30d: trader.pnl_30d || 0,
            roi_7d_pct: trader.roi_7d_pct || 0,
            roi_30d_pct: trader.roi_30d_pct || 0,
            win_rate: trader.win_rate || 0,
            profit_factor: trader.profit_factor || 1,
            total_trades: trader.total_trades || 0,
            quality_tier: newTier,
            previous_tier: previousTier,
            tier_changed: true,
            change_reason: `unrealized_drawdown: ${reason}`,
          });
          
          logger.info(`🔻 ${trader.address.slice(0, 10)}... ${previousTier.toUpperCase()} → ${newTier.toUpperCase()}: ${reason}`);
          
          stats.demoted++;
          stats.demotedForDrawdown++;
          if (!isTracked) stats.removedFromTracking++;
          demotedByDrawdown = true;
          
          continue; // Skip regular analysis
        }
      }
      
      // ============================================
      // Regular re-analysis
      // ============================================
      const analysis = await analyzeTrader(trader.address);
      
      if (!analysis) {
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
          roi_7d_pct: 0,
          roi_30d_pct: 0,
          win_rate: 0,
          profit_factor: 0,
          total_trades: 0,
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
      const updatedAnalysis: TraderAnalysis = {
        ...analysis,
        quality_tier: finalTier as 'elite' | 'good' | 'weak',
        is_tracked: isTracked,
      };
      
      // Save the updated analysis
      await saveTraderAnalysis(updatedAnalysis);
      
      // Update tier change tracking
      await updateTierChangeTracking(trader.address, finalTier, previousTier);
      
      // Save history entry
      await saveTraderHistory({
        address: trader.address,
        pnl_7d: analysis.pnl_7d,
        pnl_30d: analysis.pnl_30d,
        roi_7d_pct: analysis.roi_7d_pct,
        roi_30d_pct: analysis.roi_30d_pct,
        win_rate: analysis.win_rate,
        profit_factor: analysis.profit_factor,
        total_trades: analysis.total_trades,
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
    logger.info(`Demoted: ${stats.demoted} (${stats.demotedForDrawdown} for unrealized drawdown)`);
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
 * V5: Quick check of just unrealized drawdowns (can run more frequently)
 * This doesn't do full analysis, just checks current position health
 */
export async function checkUnrealizedDrawdowns(): Promise<number> {
  logger.info('Checking unrealized drawdowns...');
  
  let demotedCount = 0;
  
  try {
    const { data: trackedTraders, error } = await db.client
      .from('trader_quality')
      .select('address, quality_tier')
      .eq('is_tracked', true)
      .in('quality_tier', ['elite', 'good']);
    
    if (error || !trackedTraders) {
      return 0;
    }
    
    for (const trader of trackedTraders) {
      const unrealizedSummary = await getTraderUnrealizedPnl(trader.address);
      
      if (!unrealizedSummary) continue;
      
      const currentDrawdownPct = unrealizedSummary.unrealizedPnlPct < 0 
        ? Math.abs(unrealizedSummary.unrealizedPnlPct) 
        : 0;
      
      // Update tracking
      await updateUnrealizedDrawdownTracking(trader.address, currentDrawdownPct);
      
      // Check if should demote
      const { demote, reason } = await shouldDemoteForSustainedDrawdown(
        trader.address,
        currentDrawdownPct
      );
      
      if (demote) {
        const previousTier = trader.quality_tier;
        const newTier = previousTier === 'elite' ? 'good' : 'weak';
        const isTracked = newTier !== 'weak';
        
        await db.client
          .from('trader_quality')
          .update({
            quality_tier: newTier,
            is_tracked: isTracked,
          })
          .eq('address', trader.address);
        
        logger.info(`🔻 ${trader.address.slice(0, 10)}... ${previousTier.toUpperCase()} → ${newTier.toUpperCase()}: ${reason}`);
        demotedCount++;
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    if (demotedCount > 0) {
      logger.info(`Demoted ${demotedCount} traders due to sustained drawdown`);
    }
    
  } catch (error) {
    logger.error('Drawdown check failed', error);
  }
  
  return demotedCount;
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
    .select('address, quality_tier, tier_change_count, pnl_7d, roi_7d_pct, win_rate')
    .gt('tier_change_count', 0)
    .order('tier_change_count', { ascending: false })
    .limit(limit);
  
  return data || [];
}

/**
 * V5: Get traders currently in drawdown
 */
export async function getTradersInDrawdown(): Promise<unknown[]> {
  const { data } = await db.client
    .from('trader_quality')
    .select('address, quality_tier, max_unrealized_drawdown_pct, unrealized_drawdown_since, current_unrealized_pnl_pct')
    .eq('is_tracked', true)
    .not('unrealized_drawdown_since', 'is', null)
    .order('max_unrealized_drawdown_pct', { ascending: false });
  
  return data || [];
}

export default {
  reEvaluateAllTraders,
  checkUnrealizedDrawdowns,
  cleanupOldHistory,
  getTraderHistory,
  getVolatileTraders,
  getTradersInDrawdown,
};