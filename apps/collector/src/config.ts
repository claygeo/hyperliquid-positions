// Configuration for Quality Trader System V5
// Enhanced with WebSocket, conviction scoring, volatility stops, and funding context
// Updated with ROI-based quality thresholds
// V5: Less aggressive reeval to prevent wrongful demotions

export const config = {
  // Supabase connection
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',

  // API endpoints
  hyperliquid: {
    api: 'https://api.hyperliquid.xyz/info',
    ws: 'wss://api.hyperliquid.xyz/ws',
  },
  hypurrscan: {
    holdersApi: 'https://api.hypurrscan.io/holdersWithLimit/HYPE/10000',
  },

  // HYPE holder thresholds
  holders: {
    minHypeBalance: 500,
    fetchLimit: 10000,
  },

  // ============================================
  // QUALITY TIER THRESHOLDS (ROI-based)
  // ============================================
  // Uses OR logic: qualifies if ROI% > threshold OR absolute PnL > alt threshold
  // This catches both small account killers AND profitable whales
  quality: {
    elite: {
      // ROI-based (primary) - catches small accounts with huge % returns
      minRoi7dPct: 15,          // 15% weekly return
      // Absolute PnL (alternative) - catches whales with lower % but big $ 
      minPnl7dAlt: 50000,       // $50k absolute profit
      // Other requirements
      minWinRate: 0.40,         // 40% - accepts trend followers who win big
      minTrades: 15,            // Enough sample size
      minProfitFactor: 2.0,     // Strong edge requirement
      // Data quality
      minAccountValue: 1000,    // Filter out stale/withdrawn accounts
    },
    good: {
      // ROI-based (primary)
      minRoi7dPct: 5,           // 5% weekly return
      // Absolute PnL (alternative)
      minPnl7dAlt: 10000,       // $10k absolute profit
      // Other requirements
      minWinRate: 0.35,         // 35% - very accepting of different styles
      minTrades: 8,             // Moderate sample size
      minProfitFactor: 1.5,     // Must show positive edge
      // Data quality
      minAccountValue: 500,     // Filter out dust accounts
    },
    // Legacy thresholds (kept for reference, not used)
    legacyElite: {
      minPnl7d: 25000,
      minPnl30d: 25000,
      minWinRate: 0.50,
      minTrades: 15,
      minProfitFactor: 1.5,
    },
    legacyGood: {
      minPnl7d: 5000,
      minPnl30d: 5000,
      minWinRate: 0.48,
      minTrades: 8,
      minProfitFactor: 1.2,
    },
  },

  // ============================================
  // SIGNAL REQUIREMENTS
  // ============================================
  signals: {
    // Minimum traders for a signal
    minEliteForSignal: 1,
    minGoodForSignal: 2,
    minMixedForSignal: { elite: 1, good: 1 },

    // Strong signal thresholds
    strongSignal: {
      minElite: 2,
      minGood: 4,
      minMixed: { elite: 1, good: 2 },
    },

    // Directional agreement filter
    minDirectionalAgreement: 0.65,

    // Minimum combined metrics
    minCombinedPnl7d: 10000,
    minAvgWinRate: 0.45,        // Lowered to match new thresholds
    minAvgProfitFactor: 1.3,

    // Signal expiry
    expiryHours: 4,

    // Risk management
    defaultStopPct: 0.03,
    takeProfitMultiples: [1, 2, 3],
    maxSuggestedLeverage: 10,
  },

  // ============================================
  // V4: VOLATILITY-ADJUSTED STOPS
  // ============================================
  volatility: {
    // ATR multiplier for stop loss
    defaultAtrMultiple: 1.5,
    
    // Min/max stop distance bounds
    minStopPct: 1,
    maxStopPct: 10,
    
    // Update interval (ms) - every 4 hours
    updateIntervalMs: 4 * 60 * 60 * 1000,
  },

  // ============================================
  // V4: CONVICTION SCORING
  // ============================================
  conviction: {
    // High conviction threshold (position size as % of account)
    highConvictionPct: 30,
    mediumConvictionPct: 15,
    lowConvictionPct: 5,
    
    // Bonus confidence for high conviction signals
    highConvictionBonus: 10,
    mediumConvictionBonus: 5,
  },

  // ============================================
  // V4: FUNDING CONTEXT
  // ============================================
  funding: {
    // Threshold for favorable/unfavorable (per 8h)
    favorableThreshold: -0.0001,
    unfavorableThreshold: 0.0001,
    
    // Update intervals
    snapshotIntervalMs: 30 * 60 * 1000,
    traderExposureIntervalMs: 4 * 60 * 60 * 1000,
  },

  // ============================================
  // V4: WEBSOCKET STREAMING
  // ============================================
  websocket: {
    enabled: true,
    reconnectDelayMs: 5000,
    heartbeatIntervalMs: 30000,
    refreshSubscriptionsMs: 5 * 60 * 1000,
  },

  // ============================================
  // V5: URGENT RE-EVALUATION (LESS AGGRESSIVE)
  // ============================================
  // Unrealized losses are normal for leveraged traders
  // Only trigger urgent reeval for truly severe situations
  urgentReeval: {
    severeDrawdownPct: -30,      // Was -15, now -30 (only panic at 30% drawdown)
    eliteDrawdownPct: -20,       // Was -10, now -20 (elite can handle more)
    processIntervalMs: 2 * 60 * 1000,
    maxPerCycle: 5,
  },

  // ============================================
  // SIGNAL PERFORMANCE TRACKING
  // ============================================
  signalTracking: {
    updateIntervalMs: 60000,
    priceUpdateIntervalMs: 30000,
    closeOnTraderExit: false,    // V5: Don't close just because traders exit
    closeOnStopHit: true,
    closeOnTargetHit: false,
    maxSignalHours: 168,         // 7 days max
  },

  // ============================================
  // TRADER RE-EVALUATION
  // ============================================
  reeval: {
    fullReevalIntervalHours: 168,
    
    demoteEliteIf: {
      pnl7dBelow: -10000,        // Was -5000, now more lenient
      roi7dBelow: -20,           // Was -10, now -20% weekly
      winRateBelow: 0.30,        // Was 0.35, now 0.30
      profitFactorBelow: 0.8,    // Was 1.0, now 0.8
    },
    
    demoteGoodIf: {
      pnl7dBelow: -15000,        // Was -10000
      roi7dBelow: -25,           // Was -15, now -25% weekly
      winRateBelow: 0.25,        // Was 0.30
    },
    
    keepHistoryDays: 90,
  },

  // Position tracking
  positions: {
    majorAssets: ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'DOGE', 'SUI', 'AVAX', 'LINK', 'BNB'],
    minPositionValue: 5000,
    pollIntervalMs: 60000,
  },

  // Analysis settings
  analysis: {
    batchSize: 10,
    batchDelayMs: 1000,
    reanalyzeEliteHours: 1,
    reanalyzeGoodHours: 4,
    reanalyzeWeakHours: 24,
  },

  // ============================================
  // RATE LIMITING (slightly more conservative)
  // ============================================
  rateLimit: {
    requestsPerSecond: 1.5,      // Was 2, now 1.5 to reduce 429s
    delayBetweenRequests: 750,   // Was 500, now 750ms
    maxRetries: 3,
    retryDelayMs: 1500,          // Was 1000, now 1500ms
  },
};

export default config;