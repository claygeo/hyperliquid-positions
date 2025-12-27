// Convergence Detector - Smart scoring based on freshness, PnL, conviction

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';

var logger = createLogger('processor:convergence');

// Only track major liquid assets
var MAJOR_ASSETS = ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'DOGE', 'SUI', 'AVAX', 'LINK', 'BNB'];

// Time windows
var FRESH_WINDOW_MS = 60 * 60 * 1000; // 60 minutes for "fresh" entries
var LOOKBACK_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours total lookback
var SIGNAL_EXPIRY_HOURS = 4;

// Minimum requirements
var MIN_WALLETS = 3;
var MIN_FRESH_WALLETS = 2;

interface PositionChange {
  wallet: string;
  coin: string;
  direction: string;
  change_type: string;
  value_usd: number;
  entry_price: number;
  unrealized_pnl: number;
  return_on_equity: number;
  position_pct: number;
  account_value: number;
  is_winning: boolean;
  detected_at: string;
}

interface ConvergenceGroup {
  coin: string;
  direction: string;
  wallets: string[];
  freshWallets: string[];
  winningCount: number;
  losingCount: number;
  totalValue: number;
  avgEntryPrice: number;
  avgReturnPct: number;
  avgPositionPct: number;
  freshestEntry: Date;
  oldestEntry: Date;
}

interface SignalRecord {
  id?: number;
  coin: string;
  direction: string;
  wallet_count: number;
  wallets: string[];
  avg_entry_price: number;
  total_value_usd: number;
  confidence: number;
  signal_strength: string;
  fresh_entries: number;
  winning_count: number;
  losing_count: number;
  avg_return_pct: number;
  avg_position_pct: number;
  freshness_minutes: number;
  time_window_minutes: number;
  is_active: boolean;
  expires_at: string;
  created_at?: string;
}

function calculateSignalStrength(group: ConvergenceGroup): { confidence: number; strength: string } {
  var confidence = 0;
  
  // Base score from fresh wallet count (up to 30 points)
  confidence += Math.min(30, group.freshWallets.length * 10);
  
  // Winning vs losing (up to 25 points, can go negative)
  var totalTraders = group.winningCount + group.losingCount;
  if (totalTraders > 0) {
    var winRatio = group.winningCount / totalTraders;
    if (winRatio >= 0.7) {
      confidence += 25;
    } else if (winRatio >= 0.5) {
      confidence += 15;
    } else if (winRatio < 0.3) {
      confidence -= 20;
    }
  }
  
  // Conviction - avg position size as % of account (up to 20 points)
  if (group.avgPositionPct >= 20) {
    confidence += 20;
  } else if (group.avgPositionPct >= 10) {
    confidence += 15;
  } else if (group.avgPositionPct >= 5) {
    confidence += 10;
  }
  
  // Total value in position (up to 15 points)
  if (group.totalValue >= 10000000) {
    confidence += 15;
  } else if (group.totalValue >= 1000000) {
    confidence += 10;
  } else if (group.totalValue >= 100000) {
    confidence += 5;
  }
  
  // Freshness bonus (up to 10 points)
  var freshestMs = new Date().getTime() - group.freshestEntry.getTime();
  if (freshestMs < 15 * 60 * 1000) {
    confidence += 10;
  } else if (freshestMs < 30 * 60 * 1000) {
    confidence += 5;
  }
  
  // Clamp confidence
  confidence = Math.max(0, Math.min(100, confidence));
  
  // Determine strength label
  var strength: string;
  if (confidence >= 80) {
    strength = 'very_strong';
  } else if (confidence >= 60) {
    strength = 'strong';
  } else if (confidence >= 40) {
    strength = 'medium';
  } else {
    strength = 'weak';
  }
  
  return { confidence: confidence, strength: strength };
}

export async function detectConvergence(): Promise<void> {
  var cutoffTime = new Date(Date.now() - LOOKBACK_WINDOW_MS).toISOString();
  var freshCutoff = new Date(Date.now() - FRESH_WINDOW_MS).toISOString();
  
  // Get recent position changes for major assets only
  var result = await db.client
    .from('position_changes')
    .select('*')
    .in('coin', MAJOR_ASSETS)
    .in('change_type', ['open', 'increase', 'flip'])
    .gte('detected_at', cutoffTime)
    .gt('value_usd', 10000);
  
  if (result.error) {
    logger.error('Failed to fetch position changes', result.error);
    return;
  }
  
  var changes = result.data as PositionChange[];
  
  if (!changes || changes.length === 0) {
    return;
  }
  
  // Group by coin + direction
  var groups = new Map<string, ConvergenceGroup>();
  
  for (var i = 0; i < changes.length; i++) {
    var change = changes[i];
    var key = change.coin + '_' + change.direction;
    
    var group = groups.get(key);
    if (!group) {
      group = {
        coin: change.coin,
        direction: change.direction,
        wallets: [],
        freshWallets: [],
        winningCount: 0,
        losingCount: 0,
        totalValue: 0,
        avgEntryPrice: 0,
        avgReturnPct: 0,
        avgPositionPct: 0,
        freshestEntry: new Date(change.detected_at),
        oldestEntry: new Date(change.detected_at),
      };
      groups.set(key, group);
    }
    
    // Only count each wallet once per group
    if (group.wallets.indexOf(change.wallet) === -1) {
      group.wallets.push(change.wallet);
      group.totalValue += change.value_usd || 0;
      group.avgEntryPrice += change.entry_price || 0;
      group.avgReturnPct += (change.return_on_equity || 0) * 100;
      group.avgPositionPct += change.position_pct || 0;
      
      if (change.is_winning) {
        group.winningCount++;
      } else {
        group.losingCount++;
      }
      
      // Track if this is a fresh entry
      var changeTime = new Date(change.detected_at);
      if (change.detected_at >= freshCutoff) {
        group.freshWallets.push(change.wallet);
      }
      
      // Track freshest and oldest
      if (changeTime > group.freshestEntry) {
        group.freshestEntry = changeTime;
      }
      if (changeTime < group.oldestEntry) {
        group.oldestEntry = changeTime;
      }
    }
  }
  
  // Process each group
  var signalsCreated = 0;
  var signalsUpdated = 0;
  
  var groupKeys = Array.from(groups.keys());
  for (var j = 0; j < groupKeys.length; j++) {
    var groupKey = groupKeys[j];
    var grp = groups.get(groupKey);
    if (!grp) continue;
    
    // Calculate averages
    var walletCount = grp.wallets.length;
    if (walletCount > 0) {
      grp.avgEntryPrice = grp.avgEntryPrice / walletCount;
      grp.avgReturnPct = grp.avgReturnPct / walletCount;
      grp.avgPositionPct = grp.avgPositionPct / walletCount;
    }
    
    // Check minimum requirements
    if (walletCount < MIN_WALLETS) continue;
    if (grp.freshWallets.length < MIN_FRESH_WALLETS) continue;
    
    // Calculate signal strength
    var scoring = calculateSignalStrength(grp);
    
    // Skip weak signals
    if (scoring.confidence < 40) continue;
    
    // Calculate freshness in minutes
    var freshnessMs = new Date().getTime() - grp.freshestEntry.getTime();
    var freshnessMinutes = Math.round(freshnessMs / 60000);
    
    // Check if signal already exists
    var existing = await db.client
      .from('convergence_signals')
      .select('id')
      .eq('coin', grp.coin)
      .eq('direction', grp.direction)
      .eq('is_active', true)
      .single();
    
    var signalData: SignalRecord = {
      coin: grp.coin,
      direction: grp.direction,
      wallet_count: walletCount,
      wallets: grp.wallets,
      avg_entry_price: grp.avgEntryPrice,
      total_value_usd: grp.totalValue,
      confidence: scoring.confidence,
      signal_strength: scoring.strength,
      fresh_entries: grp.freshWallets.length,
      winning_count: grp.winningCount,
      losing_count: grp.losingCount,
      avg_return_pct: grp.avgReturnPct,
      avg_position_pct: grp.avgPositionPct,
      freshness_minutes: freshnessMinutes,
      time_window_minutes: 120,
      is_active: true,
      expires_at: new Date(Date.now() + SIGNAL_EXPIRY_HOURS * 60 * 60 * 1000).toISOString(),
    };
    
    if (existing.data) {
      // Update existing signal
      await db.client
        .from('convergence_signals')
        .update(signalData)
        .eq('id', existing.data.id);
      
      signalsUpdated++;
      logger.info('🔄 Updated: ' + grp.coin + ' ' + grp.direction.toUpperCase() + ' - ' + walletCount + ' wallets (' + grp.freshWallets.length + ' fresh) | ' + scoring.strength.toUpperCase());
    } else {
      // Create new signal - add created_at
      signalData.created_at = new Date().toISOString();
      
      await db.client
        .from('convergence_signals')
        .insert(signalData);
      
      signalsCreated++;
      
      // Log prominent alert for new signals
      logger.info('');
      logger.info('🚨 ════════════════════════════════════════════════════════════');
      logger.info('🚨 NEW SIGNAL: ' + grp.coin + ' ' + grp.direction.toUpperCase() + ' [' + scoring.strength.toUpperCase() + ']');
      logger.info('🚨 Wallets: ' + walletCount + ' total | ' + grp.freshWallets.length + ' fresh (last 60 min)');
      logger.info('🚨 Winning: ' + grp.winningCount + '/' + walletCount + ' (' + Math.round(grp.winningCount / walletCount * 100) + '%) | Avg Return: ' + (grp.avgReturnPct >= 0 ? '+' : '') + grp.avgReturnPct.toFixed(1) + '%');
      logger.info('🚨 Confidence: ' + scoring.confidence + '% | Avg Position: ' + grp.avgPositionPct.toFixed(1) + '% of account');
      logger.info('🚨 Total Value: $' + Math.round(grp.totalValue).toLocaleString());
      logger.info('🚨 ════════════════════════════════════════════════════════════');
      logger.info('');
    }
  }
  
  if (signalsCreated > 0 || signalsUpdated > 0) {
    logger.info('Convergence scan complete: ' + signalsCreated + ' new, ' + signalsUpdated + ' updated');
  }
}

// Alias for backwards compatibility
export async function checkConvergence(): Promise<void> {
  return detectConvergence();
}

export async function expireOldSignals(): Promise<void> {
  var now = new Date().toISOString();
  
  var result = await db.client
    .from('convergence_signals')
    .update({ is_active: false })
    .eq('is_active', true)
    .lt('expires_at', now);
  
  if (result.error) {
    logger.error('Failed to expire old signals', result.error);
  }
}

export async function getActiveSignals(): Promise<SignalRecord[]> {
  var result = await db.client
    .from('convergence_signals')
    .select('*')
    .eq('is_active', true)
    .order('confidence', { ascending: false })
    .limit(20);
  
  return result.data || [];
}

// Alias for backwards compatibility
export async function getRecentSignals(): Promise<SignalRecord[]> {
  return getActiveSignals();
}

export default { 
  detectConvergence, 
  checkConvergence,
  expireOldSignals, 
  getActiveSignals,
  getRecentSignals
};