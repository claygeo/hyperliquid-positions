// Processors index - Export all processors

export { 
  checkConvergence, 
  getActiveSignals, 
  getRecentSignals,
  expireOldSignals 
} from './convergence-detector.js';

// Legacy exports (can be removed later)
export { processTrade, flushPendingData } from './trade-processor.js';
export { processTradeForAlpha, flushAlphaBuffer, getTopAlphaWallets } from './alpha-detector.js';