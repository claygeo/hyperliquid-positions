// Scoring configuration and thresholds

import type { ScoringWeights } from '../types/wallet';

// Default scoring weights
export const SCORING_WEIGHTS: ScoringWeights = {
  entryQuality: 0.35,    // Most important - can they time entries?
  winRate: 0.25,         // Consistency matters
  riskAdjusted: 0.20,    // Risk management
  consistency: 0.10,     // Steady performance
  fundingEfficiency: 0.10, // Funding arbitrage skill
};

// Minimum thresholds for scoring reliability
export const SCORING_THRESHOLDS = {
  // Minimum trades to calculate reliable scores
  MIN_TRADES_FOR_SCORE: 20,
  MIN_TRADES_FOR_CONFIDENCE: 50,
  MIN_TRADES_FOR_HIGH_CONFIDENCE: 100,
  
  // Volume thresholds
  MIN_VOLUME_FOR_TRACKING: 10_000, // $10k
  MIN_VOLUME_FOR_SCORE: 50_000,    // $50k
  
  // Time thresholds (milliseconds)
  ENTRY_SCORE_5M: 5 * 60 * 1000,
  ENTRY_SCORE_1H: 60 * 60 * 1000,
  ENTRY_SCORE_4H: 4 * 60 * 60 * 1000,
  
  // Wallet activity
  INACTIVE_AFTER_DAYS: 30,
  STALE_POSITION_HOURS: 24,
} as const;

// Score tier definitions
export const SCORE_TIERS = {
  exceptional: { min: 0.8, label: 'Exceptional', color: '#22c55e' },
  good: { min: 0.6, label: 'Good', color: '#84cc16' },
  average: { min: 0.4, label: 'Average', color: '#eab308' },
  poor: { min: 0.2, label: 'Poor', color: '#f97316' },
  bad: { min: 0, label: 'Bad', color: '#ef4444' },
} as const;

export type ScoreTier = keyof typeof SCORE_TIERS;

// Get tier for a score
export function getScoreTier(score: number | null): ScoreTier {
  if (score === null) return 'average';
  if (score >= SCORE_TIERS.exceptional.min) return 'exceptional';
  if (score >= SCORE_TIERS.good.min) return 'good';
  if (score >= SCORE_TIERS.average.min) return 'average';
  if (score >= SCORE_TIERS.poor.min) return 'poor';
  return 'bad';
}

// Confidence calculation based on sample size
export function calculateConfidence(tradeCount: number): number {
  const { MIN_TRADES_FOR_SCORE, MIN_TRADES_FOR_HIGH_CONFIDENCE } = SCORING_THRESHOLDS;
  
  if (tradeCount < MIN_TRADES_FOR_SCORE) return 0;
  if (tradeCount >= MIN_TRADES_FOR_HIGH_CONFIDENCE) return 1;
  
  // Linear interpolation between min and high confidence
  return (tradeCount - MIN_TRADES_FOR_SCORE) / 
         (MIN_TRADES_FOR_HIGH_CONFIDENCE - MIN_TRADES_FOR_SCORE);
}

// Entry score calculation
// Returns -1 to 1 based on price movement after entry
export function calculateEntryScore(
  side: 'B' | 'A',
  entryPrice: number,
  laterPrice: number
): number {
  const priceChange = (laterPrice - entryPrice) / entryPrice;
  
  // For buys: positive price change = good entry
  // For sells: negative price change = good entry
  const directionMultiplier = side === 'B' ? 1 : -1;
  const rawScore = priceChange * directionMultiplier;
  
  // Cap at -1 to 1
  return Math.max(-1, Math.min(1, rawScore * 10)); // Scale up small moves
}

// Win rate normalization (maps 40-70% to 0-1)
export function normalizeWinRate(winRate: number): number {
  // Below 40% is considered poor, above 70% is exceptional
  const MIN_WIN_RATE = 0.40;
  const MAX_WIN_RATE = 0.70;
  
  if (winRate <= MIN_WIN_RATE) return 0;
  if (winRate >= MAX_WIN_RATE) return 1;
  
  return (winRate - MIN_WIN_RATE) / (MAX_WIN_RATE - MIN_WIN_RATE);
}

// Signal thresholds
export const SIGNAL_THRESHOLDS = {
  // Minimum score for auto-signals
  MIN_WALLET_SCORE: 0.6,
  
  // Position size anomaly
  UNUSUAL_SIZE_MULTIPLIER: 3, // 3x average size
  
  // Cluster convergence
  MIN_CLUSTER_AGREEMENT: 0.7, // 70% of cluster in same direction
  
  // Confidence thresholds
  HIGH_CONFIDENCE: 0.8,
  MEDIUM_CONFIDENCE: 0.6,
  LOW_CONFIDENCE: 0.4,
} as const;

// Discovery thresholds
export const DISCOVERY_THRESHOLDS = {
  // Minimum activity to consider tracking
  MIN_TRADES_FOR_DISCOVERY: 10,
  MIN_VOLUME_FOR_DISCOVERY: 5_000,
  
  // Preliminary score threshold
  MIN_PRELIMINARY_SCORE: 0.4,
  
  // Rate limit for new wallet discovery
  MAX_NEW_WALLETS_PER_HOUR: 100,
} as const;
