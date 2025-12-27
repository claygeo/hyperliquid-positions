// Convergence Detector - Find when multiple top traders enter same position

import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';

const logger = createLogger('processor:convergence');

// Minimum wallets needed for a convergence signal
const MIN_WALLETS_FOR_SIGNAL = 3;
// Time window to look for convergence (in minutes)
const CONVERGENCE_WINDOW_MINUTES = 120; // 2 hours
// Minimum confidence score
const MIN_CONFIDENCE = 60;

interface ConvergenceCandidate {
  coin: string;
  direction: string;
  wallet_count: number;
  wallets: string[];
  avg_entry_price: number;
  total_value_usd: number;
}

/**
 * Check for convergence signals
 */
export async function checkConvergence(): Promise<void> {
  try {
    // Find coins where multiple wallets have opened/increased in same direction
    const { data: changes, error } = await db.client
      .from('position_changes')
      .select('wallet, coin, direction, entry_price, value_usd, change_type')
      .in('change_type', ['open', 'increase', 'flip'])
      .gte('detected_at', new Date(Date.now() - CONVERGENCE_WINDOW_MINUTES * 60 * 1000).toISOString())
      .order('detected_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch position changes', error);
      return;
    }

    if (!changes || changes.length === 0) {
      return;
    }

    // Group by coin + direction
    const groups = new Map<string, ConvergenceCandidate>();

    for (const change of changes) {
      const key = `${change.coin}:${change.direction}`;
      
      if (!groups.has(key)) {
        groups.set(key, {
          coin: change.coin,
          direction: change.direction,
          wallet_count: 0,
          wallets: [],
          avg_entry_price: 0,
          total_value_usd: 0,
        });
      }

      const group = groups.get(key)!;
      
      // Only count each wallet once per group
      if (!group.wallets.includes(change.wallet)) {
        group.wallets.push(change.wallet);
        group.wallet_count++;
        group.total_value_usd += change.value_usd || 0;
        
        // Running average for entry price
        const prevTotal = group.avg_entry_price * (group.wallet_count - 1);
        group.avg_entry_price = (prevTotal + (change.entry_price || 0)) / group.wallet_count;
      }
    }

    // Check for convergence signals
    for (const [key, candidate] of groups) {
      if (candidate.wallet_count >= MIN_WALLETS_FOR_SIGNAL) {
        await processConvergenceSignal(candidate);
      }
    }
  } catch (error) {
    logger.error('Convergence check failed', error);
  }
}

/**
 * Calculate confidence score for a convergence signal
 */
function calculateConfidence(candidate: ConvergenceCandidate): number {
  let confidence = 0;

  // Base confidence from wallet count (3 wallets = 50, 5+ = 70)
  confidence += Math.min(70, 30 + (candidate.wallet_count * 8));

  // Bonus for high total value (>$100k = +15)
  if (candidate.total_value_usd > 100000) {
    confidence += 15;
  } else if (candidate.total_value_usd > 50000) {
    confidence += 10;
  } else if (candidate.total_value_usd > 20000) {
    confidence += 5;
  }

  // Bonus for many wallets (5+ = +15)
  if (candidate.wallet_count >= 5) {
    confidence += 15;
  }

  return Math.min(100, confidence);
}

/**
 * Process and save a convergence signal
 */
async function processConvergenceSignal(candidate: ConvergenceCandidate): Promise<void> {
  const confidence = calculateConfidence(candidate);

  if (confidence < MIN_CONFIDENCE) {
    return;
  }

  // Check if we already have an active signal for this coin/direction
  const { data: existing } = await db.client
    .from('convergence_signals')
    .select('id, wallet_count, wallets')
    .eq('coin', candidate.coin)
    .eq('direction', candidate.direction)
    .eq('is_active', true)
    .gte('created_at', new Date(Date.now() - CONVERGENCE_WINDOW_MINUTES * 60 * 1000).toISOString())
    .single();

  if (existing) {
    // Update existing signal if more wallets converged
    if (candidate.wallet_count > existing.wallet_count) {
      const { error } = await db.client
        .from('convergence_signals')
        .update({
          wallet_count: candidate.wallet_count,
          wallets: candidate.wallets,
          avg_entry_price: candidate.avg_entry_price,
          total_value_usd: candidate.total_value_usd,
          confidence: confidence,
        })
        .eq('id', existing.id);

      if (!error) {
        logger.info(`🔄 Updated convergence signal: ${candidate.coin} ${candidate.direction.toUpperCase()} - ${candidate.wallet_count} wallets`);
      }
    }
    return;
  }

  // Create new signal
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000); // Expires in 4 hours

  const { error } = await db.client
    .from('convergence_signals')
    .insert({
      coin: candidate.coin,
      direction: candidate.direction,
      wallet_count: candidate.wallet_count,
      wallets: candidate.wallets,
      avg_entry_price: candidate.avg_entry_price,
      total_value_usd: candidate.total_value_usd,
      confidence: confidence,
      time_window_minutes: CONVERGENCE_WINDOW_MINUTES,
      expires_at: expiresAt.toISOString(),
      is_active: true,
    });

  if (error) {
    logger.error('Failed to save convergence signal', error);
    return;
  }

  // Log the signal prominently
  logger.info('');
  logger.info('🚨 ════════════════════════════════════════════════════════════');
  logger.info(`🚨 CONVERGENCE SIGNAL: ${candidate.coin} ${candidate.direction.toUpperCase()}`);
  logger.info(`🚨 Wallets: ${candidate.wallet_count} | Confidence: ${confidence}%`);
  logger.info(`🚨 Avg Entry: $${candidate.avg_entry_price.toFixed(2)} | Total Value: $${candidate.total_value_usd.toFixed(0)}`);
  logger.info(`🚨 Traders: ${candidate.wallets.map(w => w.slice(0, 8) + '...').join(', ')}`);
  logger.info('🚨 ════════════════════════════════════════════════════════════');
  logger.info('');
}

/**
 * Get active convergence signals
 */
export async function getActiveSignals(): Promise<any[]> {
  const { data, error } = await db.client
    .from('convergence_signals')
    .select('*')
    .eq('is_active', true)
    .gt('expires_at', new Date().toISOString())
    .order('confidence', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('Failed to get active signals', error);
    return [];
  }

  return data || [];
}

/**
 * Get recent signals (including expired)
 */
export async function getRecentSignals(hours: number = 24): Promise<any[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const { data, error } = await db.client
    .from('convergence_signals')
    .select('*')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('Failed to get recent signals', error);
    return [];
  }

  return data || [];
}

/**
 * Expire old signals
 */
export async function expireOldSignals(): Promise<void> {
  const { error } = await db.client
    .from('convergence_signals')
    .update({ is_active: false })
    .lt('expires_at', new Date().toISOString())
    .eq('is_active', true);

  if (error) {
    logger.error('Failed to expire old signals', error);
  }
}

export default {
  checkConvergence,
  getActiveSignals,
  getRecentSignals,
  expireOldSignals,
};