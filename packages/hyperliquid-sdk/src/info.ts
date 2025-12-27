// Info endpoint helper methods

import type { HLClearinghouseState, HLPosition } from '@hyperliquid-tracker/shared';

/**
 * Extract positions from clearinghouse state
 */
export function extractPositions(state: HLClearinghouseState): HLPosition[] {
  return state.assetPositions.map(ap => ap.position);
}

/**
 * Check if user has any open positions
 */
export function hasOpenPositions(state: HLClearinghouseState): boolean {
  return state.assetPositions.length > 0;
}

/**
 * Get account value
 */
export function getAccountValue(state: HLClearinghouseState): number {
  return parseFloat(state.marginSummary.accountValue);
}

/**
 * Get total unrealized PnL
 */
export function getTotalUnrealizedPnl(state: HLClearinghouseState): number {
  return state.assetPositions.reduce((total, ap) => {
    return total + parseFloat(ap.position.unrealizedPnl);
  }, 0);
}

/**
 * Get position by coin
 */
export function getPositionByCoin(
  state: HLClearinghouseState,
  coin: string
): HLPosition | null {
  const ap = state.assetPositions.find(ap => ap.position.coin === coin);
  return ap?.position || null;
}

/**
 * Calculate position notional value
 */
export function getPositionNotional(position: HLPosition): number {
  return Math.abs(parseFloat(position.szi)) * parseFloat(position.entryPx);
}

/**
 * Check if position is long or short
 */
export function getPositionSide(position: HLPosition): 'long' | 'short' {
  return parseFloat(position.szi) > 0 ? 'long' : 'short';
}

/**
 * Parse position size (can be negative for shorts)
 */
export function parsePositionSize(szi: string): number {
  return parseFloat(szi);
}

/**
 * Calculate ROE percentage
 */
export function calculateROE(position: HLPosition): number {
  return parseFloat(position.returnOnEquity) * 100;
}

/**
 * Check if position is at risk of liquidation
 */
export function isNearLiquidation(
  position: HLPosition,
  currentPrice: number,
  threshold = 0.1 // 10% buffer
): boolean {
  const liqPrice = position.liquidationPx ? parseFloat(position.liquidationPx) : null;
  if (!liqPrice) return false;
  
  const isLong = parseFloat(position.szi) > 0;
  
  if (isLong) {
    return currentPrice <= liqPrice * (1 + threshold);
  } else {
    return currentPrice >= liqPrice * (1 - threshold);
  }
}
