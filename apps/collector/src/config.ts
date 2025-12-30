// Configuration for Quality Trader System V3
// Enhanced with signal tracking, directional filters, and actionable levels

export const config = {
  // Supabase connection
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_KEY || '',
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
  // V3: QUALITY TIER THRESHOLDS (Strict)
  // ============================================
  quality: {
    elite: {
      minPnl7d: 25000,        // $25k+ 7d PnL
      minPnl30d: 25000,       // $25k+ 30d PnL
      minWinRate: 0.50,       // 50%+ win rate
      minTrades: 15,          // At least 15 trades
      minProfitFactor: 1.5,   // Wins 50% larger than losses
    },
    good: {
      minPnl7d: 5000,         // $5k+ 7d PnL
      minPnl30d: 5000,        // $5k+ 30d PnL
      minWinRate: 0.48,       // 48%+ win rate
      minTrades: 8,           // At least 8 trades
      minProfitFactor: 1.2,   // Wins 20% larger than losses
    },
  },

  // ============================================
  // V3: SIGNAL REQUIREMENTS
  // ============================================
  signals: {
    // Minimum traders for a signal (V3 - lowered because quality bar is higher)
    minEliteForSignal: 1,     // 1+ elite = signal
    minGoodForSignal: 2,      // 2+ good = signal
    minMixedForSignal: { elite: 1, good: 1 }, // 1 elite + 1 good = signal

    // Strong signal thresholds
    strongSignal: {
      minElite: 2,            // 2+ elite = strong
      minGood: 4,             // OR 4+ good = strong
      minMixed: { elite: 1, good: 2 }, // OR 1 elite + 2 good = strong
    },

    // V3: DIRECTIONAL AGREEMENT FILTER
    // Only generate signal if X% of quality traders agree on direction
    minDirectionalAgreement: 0.65, // 65% must agree (no conflicting signals)
    
    // V3: Minimum combined metrics for signal
    minCombinedPnl7d: 10000,  // $10k+ combined 7d PnL
    minAvgWinRate: 0.50,      // 50%+ average win rate
    minAvgProfitFactor: 1.3,  // 1.3+ average profit factor

    // Signal expiry
    expiryHours: 4,

    // V3: Risk management defaults
    defaultStopPct: 0.03,     // 3% stop loss if can't calculate from data
    takeProfitMultiples: [1, 2, 3], // 1:1, 2:1, 3:1 risk/reward targets
    maxSuggestedLeverage: 10, // Never suggest more than 10x
  },

  // ============================================
  // V3: SIGNAL PERFORMANCE TRACKING
  // ============================================
  signalTracking: {
    // How often to update signal performance (ms)
    updateIntervalMs: 60000,  // Every minute
    
    // Price fetch for tracking
    priceUpdateIntervalMs: 30000, // Every 30 seconds
    
    // Signal closure rules
    closeOnTraderExit: true,  // Close signal when traders exit
    closeOnStopHit: true,     // Close signal if stop loss hit
    closeOnTargetHit: false,  // Don't auto-close on target (let it run)
    maxSignalHours: 168,      // Max 7 days before expiring signal
  },

  // ============================================
  // V3: TRADER RE-EVALUATION
  // ============================================
  reeval: {
    // How often to run full re-evaluation
    fullReevalIntervalHours: 168, // Weekly
    
    // Demotion rules
    demoteEliteIf: {
      pnl7dBelow: 0,          // Demote if 7d PnL goes negative
      winRateBelow: 0.45,     // Demote if win rate drops below 45%
      profitFactorBelow: 1.0, // Demote if PF drops below 1.0
    },
    
    demoteGoodIf: {
      pnl7dBelow: -5000,      // Demote if loses $5k in 7 days
      winRateBelow: 0.40,     // Demote if win rate drops below 40%
    },
    
    // Track history
    keepHistoryDays: 90,      // Keep 90 days of trader history
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

  // Rate limiting
  rateLimit: {
    requestsPerSecond: 10,
    delayBetweenRequests: 100,
  },
};

export default config;