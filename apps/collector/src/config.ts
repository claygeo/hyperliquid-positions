// Configuration for Quality Trader System V4
// Enhanced with WebSocket, conviction scoring, volatility stops, and funding context

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
  // QUALITY TIER THRESHOLDS
  // ============================================
  quality: {
    elite: {
      minPnl7d: 25000,
      minPnl30d: 25000,
      minWinRate: 0.50,
      minTrades: 15,
      minProfitFactor: 1.5,
    },
    good: {
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
    minAvgWinRate: 0.50,
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
    
    // Update interval (ms) - every 2 hours
    updateIntervalMs: 2 * 60 * 60 * 1000,
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
  // V4: URGENT RE-EVALUATION
  // ============================================
  urgentReeval: {
    severeDrawdownPct: -15,
    eliteDrawdownPct: -10,
    processIntervalMs: 2 * 60 * 1000,
    maxPerCycle: 5,
  },

  // ============================================
  // SIGNAL PERFORMANCE TRACKING
  // ============================================
  signalTracking: {
    updateIntervalMs: 60000,
    priceUpdateIntervalMs: 30000,
    closeOnTraderExit: true,
    closeOnStopHit: true,
    closeOnTargetHit: false,
    maxSignalHours: 168,
  },

  // ============================================
  // TRADER RE-EVALUATION
  // ============================================
  reeval: {
    fullReevalIntervalHours: 168,
    
    demoteEliteIf: {
      pnl7dBelow: 0,
      winRateBelow: 0.45,
      profitFactorBelow: 1.0,
    },
    
    demoteGoodIf: {
      pnl7dBelow: -5000,
      winRateBelow: 0.40,
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
  // RATE LIMITING - FIXED FOR 429 ERRORS
  // ============================================
  rateLimit: {
    requestsPerSecond: 2,
    delayBetweenRequests: 500,
    maxRetries: 3,
    retryDelayMs: 1000,
  },
};

export default config;