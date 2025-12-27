// Wallet and scoring types

export interface Wallet {
  address: string;
  firstSeen: Date;
  totalTrades: number;
  totalVolume: number;
  winRate: number | null;
  entryScore: number | null;
  riskAdjustedReturn: number | null;
  avgHoldMinutes: number | null;
  fundingEfficiency: number | null;
  overallScore: number | null;
  lastTradeAt: Date | null;
  lastUpdated: Date;
  isActive: boolean;
  clusterId: string | null;
  metadata: WalletMetadata | null;
}

export interface WalletMetadata {
  // Derived stats
  avgPositionSize?: number;
  maxDrawdown?: number;
  sharpeRatio?: number;
  
  // Behavioral patterns
  preferredCoins?: string[];
  avgLeverage?: number;
  tradingHours?: number[]; // UTC hours when most active
  
  // Labels
  tags?: string[];
  notes?: string;
  
  [key: string]: unknown;
}

export interface WalletScore {
  address: string;
  overall: number;
  components: {
    entryQuality: number;      // -1 to 1
    winRate: number;           // 0 to 1
    riskAdjusted: number;      // normalized
    consistency: number;       // 0 to 1
    fundingEfficiency: number; // -1 to 1
  };
  confidence: number; // Based on sample size
  lastUpdated: Date;
}

export interface WalletPosition {
  wallet: string;
  coin: string;
  size: number;
  entryPrice: number;
  leverage: number;
  leverageType: 'cross' | 'isolated';
  unrealizedPnl: number;
  liquidationPrice: number | null;
  marginUsed: number;
  updatedAt: Date;
}

export interface WalletTrade {
  id: number;
  wallet: string;
  coin: string;
  side: 'B' | 'A';
  size: number;
  price: number;
  timestamp: Date;
  txHash: string;
  oid: number;
  isTaker: boolean;
  fee: number;
  closedPnl: number | null;
  price5mLater: number | null;
  price1hLater: number | null;
  price4hLater: number | null;
  entryScore: number | null;
}

export interface WalletCluster {
  id: string;
  wallets: string[];
  confidence: number;
  detectionMethod: 'transfer' | 'timing' | 'both';
  totalVolume: number;
  combinedScore: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// Query filters
export interface WalletFilter {
  minScore?: number;
  maxScore?: number;
  minTrades?: number;
  minVolume?: number;
  minWinRate?: number;
  minEntryScore?: number;
  isActive?: boolean;
  clusterId?: string;
  hasPositions?: boolean;
  sortBy?: WalletSortField;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export type WalletSortField =
  | 'overall_score'
  | 'entry_score'
  | 'win_rate'
  | 'total_volume'
  | 'total_trades'
  | 'risk_adjusted_return'
  | 'last_trade_at'
  | 'first_seen';

// Wallet discovery result
export interface WalletDiscovery {
  address: string;
  tradeCount: number;
  volume: number;
  firstSeen: Date;
  lastSeen: Date;
  preliminaryScore: number;
}

// Entry analysis result
export interface EntryAnalysis {
  tradeId: number;
  wallet: string;
  coin: string;
  entryPrice: number;
  entryTime: Date;
  side: 'B' | 'A';
  price5m: number | null;
  price1h: number | null;
  price4h: number | null;
  score5m: number | null;
  score1h: number | null;
  score4h: number | null;
  finalScore: number | null;
}

// Scoring weights configuration
export interface ScoringWeights {
  entryQuality: number;
  winRate: number;
  riskAdjusted: number;
  consistency: number;
  fundingEfficiency: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  entryQuality: 0.35,
  winRate: 0.25,
  riskAdjusted: 0.20,
  consistency: 0.10,
  fundingEfficiency: 0.10,
};
