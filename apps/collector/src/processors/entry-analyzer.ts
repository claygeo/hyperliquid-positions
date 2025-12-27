// Entry timing analyzer - simplified version

import { createLogger } from '../utils/logger.js';

const logger = createLogger('processors:entry-analyzer');

/**
 * Analyze entry quality (placeholder - uses closedPnl for scoring instead)
 */
export async function analyzeEntries(limit: number = 100): Promise<number> {
  logger.debug('Entry analysis skipped - using closedPnl for scoring');
  return 0;
}

/**
 * Clear old cache entries
 */
export function clearOldCache(): void {
  // No-op
}

export default { analyzeEntries, clearOldCache };