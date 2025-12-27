// Update scores job - now handled by alpha detector

import { createLogger } from '../utils/logger.js';

const logger = createLogger('jobs:update-scores');

/**
 * Update wallet scores (handled by alpha detector)
 */
export async function updateScoresJob(): Promise<void> {
  logger.debug('Score updates handled by alpha detector');
}

export default updateScoresJob;