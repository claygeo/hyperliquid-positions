// Calculation utilities for wallet scoring and analysis

import { SCORING_WEIGHTS, normalizeWinRate, calculateConfidence } from '../constants/scoring';
import type { WalletScore, ScoringWeights } from '../types/wallet';

/**
 * Calculate win rate from trades
 */
export function calculateWinRate(
  trades: { closedPnl: number | null }[]
): number | null {
  const closedTrades = trades.filter(t => t.closedPnl !== null);
  if (closedTrades.length === 0) return null;
  
  const wins = closedTrades.filter(t => (t.closedPnl ?? 0) > 0).length;
  return wins / closedTrades.length;
}

/**
 * Calculate average entry score from trades
 */
export function calculateAvgEntryScore(
  trades: { entryScore: number | null }[]
): number | null {
  const scoredTrades = trades.filter(t => t.entryScore !== null);
  if (scoredTrades.length === 0) return null;
  
  const sum = scoredTrades.reduce((acc, t) => acc + (t.entryScore ?? 0), 0);
  return sum / scoredTrades.length;
}

/**
 * Calculate risk-adjusted return (simplified Sharpe-like ratio)
 */
export function calculateRiskAdjustedReturn(
  trades: { closedPnl: number | null }[]
): number | null {
  const pnls = trades
    .filter(t => t.closedPnl !== null)
    .map(t => t.closedPnl as number);
  
  if (pnls.length < 5) return null;
  
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((acc, pnl) => acc + Math.pow(pnl - mean, 2), 0) / pnls.length;
  const stdDev = Math.sqrt(variance);
  
  if (stdDev === 0) return mean > 0 ? 1 : -1;
  
  // Normalize to roughly -1 to 1 range
  return Math.max(-1, Math.min(1, mean / stdDev / 2));
}

/**
 * Calculate consistency score (how steady are returns)
 */
export function calculateConsistency(
  trades: { closedPnl: number | null }[]
): number | null {
  const pnls = trades
    .filter(t => t.closedPnl !== null)
    .map(t => t.closedPnl as number);
  
  if (pnls.length < 10) return null;
  
  // Count streaks of wins/losses
  let maxLossStreak = 0;
  let currentLossStreak = 0;
  let positiveMonths = 0; // Approximate by batches of trades
  
  for (const pnl of pnls) {
    if (pnl < 0) {
      currentLossStreak++;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    } else {
      currentLossStreak = 0;
    }
  }
  
  // Batch into "periods" and count positive ones
  const periodSize = Math.max(5, Math.floor(pnls.length / 10));
  for (let i = 0; i < pnls.length; i += periodSize) {
    const period = pnls.slice(i, i + periodSize);
    const periodPnl = period.reduce((a, b) => a + b, 0);
    if (periodPnl > 0) positiveMonths++;
  }
  
  const totalPeriods = Math.ceil(pnls.length / periodSize);
  const positiveRatio = positiveMonths / totalPeriods;
  
  // Penalize for long loss streaks
  const streakPenalty = Math.min(0.5, maxLossStreak * 0.1);
  
  return Math.max(0, positiveRatio - streakPenalty);
}

/**
 * Calculate funding efficiency (net funding / position time)
 */
export function calculateFundingEfficiency(
  totalFunding: number,
  totalPositionHours: number
): number | null {
  if (totalPositionHours < 24) return null; // Need at least a day of data
  
  // Normalize: good traders collect ~0.01% per hour in favorable funding
  const hourlyRate = totalFunding / totalPositionHours;
  const normalizedRate = hourlyRate / 0.0001; // 0.01% = 0.0001
  
  return Math.max(-1, Math.min(1, normalizedRate));
}

/**
 * Calculate overall wallet score
 */
export function calculateOverallScore(
  components: {
    entryQuality: number | null;
    winRate: number | null;
    riskAdjusted: number | null;
    consistency: number | null;
    fundingEfficiency: number | null;
  },
  weights: ScoringWeights = SCORING_WEIGHTS
): number | null {
  const {
    entryQuality,
    winRate,
    riskAdjusted,
    consistency,
    fundingEfficiency,
  } = components;
  
  // Need at least entry quality and win rate
  if (entryQuality === null || winRate === null) return null;
  
  // Normalize entry quality from -1,1 to 0,1
  const normalizedEntry = (entryQuality + 1) / 2;
  const normalizedWinRate = normalizeWinRate(winRate);
  
  // Use available components
  let totalWeight = weights.entryQuality + weights.winRate;
  let weightedSum = 
    normalizedEntry * weights.entryQuality +
    normalizedWinRate * weights.winRate;
  
  if (riskAdjusted !== null) {
    const normalizedRisk = (riskAdjusted + 1) / 2;
    weightedSum += normalizedRisk * weights.riskAdjusted;
    totalWeight += weights.riskAdjusted;
  }
  
  if (consistency !== null) {
    weightedSum += consistency * weights.consistency;
    totalWeight += weights.consistency;
  }
  
  if (fundingEfficiency !== null) {
    const normalizedFunding = (fundingEfficiency + 1) / 2;
    weightedSum += normalizedFunding * weights.fundingEfficiency;
    totalWeight += weights.fundingEfficiency;
  }
  
  return weightedSum / totalWeight;
}

/**
 * Build complete wallet score object
 */
export function buildWalletScore(
  address: string,
  trades: {
    closedPnl: number | null;
    entryScore: number | null;
  }[],
  fundingData?: { totalFunding: number; totalPositionHours: number }
): WalletScore {
  const entryQuality = calculateAvgEntryScore(trades);
  const winRate = calculateWinRate(trades);
  const riskAdjusted = calculateRiskAdjustedReturn(trades);
  const consistency = calculateConsistency(trades);
  const fundingEfficiency = fundingData
    ? calculateFundingEfficiency(fundingData.totalFunding, fundingData.totalPositionHours)
    : null;
  
  const overall = calculateOverallScore({
    entryQuality,
    winRate,
    riskAdjusted,
    consistency,
    fundingEfficiency,
  });
  
  return {
    address,
    overall: overall ?? 0,
    components: {
      entryQuality: entryQuality ?? 0,
      winRate: winRate ?? 0,
      riskAdjusted: riskAdjusted ?? 0,
      consistency: consistency ?? 0,
      fundingEfficiency: fundingEfficiency ?? 0,
    },
    confidence: calculateConfidence(trades.length),
    lastUpdated: new Date(),
  };
}

/**
 * Calculate average hold time in minutes
 */
export function calculateAvgHoldTime(
  trades: { timestamp: Date; side: 'B' | 'A' }[]
): number | null {
  if (trades.length < 2) return null;
  
  // Group by implied open/close pairs
  // This is a simplification - real implementation would track position changes
  const sortedTrades = [...trades].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );
  
  let totalHoldTime = 0;
  let holdCount = 0;
  let openTime: number | null = null;
  
  for (const trade of sortedTrades) {
    if (openTime === null) {
      openTime = trade.timestamp.getTime();
    } else {
      const holdTime = trade.timestamp.getTime() - openTime;
      totalHoldTime += holdTime;
      holdCount++;
      openTime = null;
    }
  }
  
  if (holdCount === 0) return null;
  
  return totalHoldTime / holdCount / 60000; // Convert to minutes
}

/**
 * Calculate total volume from trades
 */
export function calculateTotalVolume(
  trades: { size: number; price: number }[]
): number {
  return trades.reduce((sum, t) => sum + Math.abs(t.size * t.price), 0);
}

/**
 * Detect if wallet might be a bot based on patterns
 */
export function detectBotPatterns(
  trades: { timestamp: Date; size: number }[]
): { isLikelyBot: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let botScore = 0;
  
  if (trades.length < 20) {
    return { isLikelyBot: false, confidence: 0, reasons: ['Insufficient data'] };
  }
  
  // Check for regular intervals
  const intervals: number[] = [];
  for (let i = 1; i < trades.length; i++) {
    intervals.push(
      trades[i].timestamp.getTime() - trades[i - 1].timestamp.getTime()
    );
  }
  
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const intervalVariance = intervals.reduce(
    (acc, i) => acc + Math.pow(i - avgInterval, 2), 0
  ) / intervals.length;
  const intervalCV = Math.sqrt(intervalVariance) / avgInterval;
  
  if (intervalCV < 0.2) {
    reasons.push('Very regular trade intervals');
    botScore += 0.4;
  }
  
  // Check for identical sizes
  const sizes = trades.map(t => t.size);
  const uniqueSizes = new Set(sizes.map(s => s.toFixed(4)));
  const sizeUniqueness = uniqueSizes.size / sizes.length;
  
  if (sizeUniqueness < 0.1) {
    reasons.push('Identical trade sizes');
    botScore += 0.3;
  }
  
  // Check for 24/7 activity
  const hours = trades.map(t => t.timestamp.getUTCHours());
  const uniqueHours = new Set(hours);
  
  if (uniqueHours.size >= 20) {
    reasons.push('24/7 trading activity');
    botScore += 0.3;
  }
  
  return {
    isLikelyBot: botScore >= 0.5,
    confidence: Math.min(1, botScore),
    reasons,
  };
}
