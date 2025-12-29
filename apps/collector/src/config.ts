// Configuration for Quality Trader System

export const config = {
  // Supabase (used by existing client.ts)
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
    minHypeBalance: 1000, // Minimum HYPE to be considered (filters to ~5k wallets)
    fetchLimit: 10000, // Max holders to fetch per request
  },

  // Quality tier thresholds
  quality: {
    elite: {
      minPnl7d: 25000, // $25k+ 7d PnL
      minWinRate: 0.50, // 50%+ win rate
    },
    good: {
      minPnl7d: 0, // Break-even or better
      minWinRate: 0.45, // 45%+ win rate (if PnL is negative but close)
    },
  },

  // Signal requirements
  signals: {
    // Minimum traders for a signal
    minEliteForSignal: 2, // 2+ elite = signal
    minGoodForSignal: 3, // 3+ good = signal
    minMixedForSignal: { elite: 1, good: 2 }, // 1 elite + 2 good = signal
    
    // Signal expiry
    expiryHours: 4,
  },

  // Position tracking
  positions: {
    majorAssets: ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'DOGE', 'SUI', 'AVAX', 'LINK', 'BNB'],
    minPositionValue: 5000, // $5k minimum position to track
    pollIntervalMs: 60000, // 60 seconds
  },

  // Analysis settings  
  analysis: {
    batchSize: 10, // Wallets to analyze concurrently
    batchDelayMs: 1000, // Delay between batches (rate limiting)
    reanalyzeEliteHours: 1, // Re-analyze elite traders every hour
    reanalyzeGoodHours: 4, // Re-analyze good traders every 4 hours
    reanalyzeWeakHours: 24, // Re-analyze weak traders daily
  },

  // Rate limiting
  rateLimit: {
    requestsPerSecond: 10,
    delayBetweenRequests: 100, // ms
  },
};

// Also export as CONFIG for backwards compatibility with existing files
export const CONFIG = config;

export default config;