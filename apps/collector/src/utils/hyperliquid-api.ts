// Hyperliquid API V4 - Comprehensive API Client
// All endpoints in one place with proper typing

import { createLogger } from './logger.js';

const logger = createLogger('hyperliquid-api');

const API_URL = 'https://api.hyperliquid.xyz/info';

// ============================================
// Types
// ============================================

export interface Position {
  coin: string;
  szi: string; // Signed size (negative = short)
  entryPx: string;
  positionValue: string;
  unrealizedPnl: string;
  marginUsed: string;
  liquidationPx: string | null;
  leverage: { type: string; value: number };
  returnOnEquity: string;
  maxLeverage: number;
}

export interface ClearinghouseState {
  marginSummary: {
    accountValue: string;
    totalMarginUsed: string;
    totalNtlPos: string;
    totalRawUsd: string;
  };
  assetPositions: Array<{ position: Position }>;
  crossMaintenanceMarginUsed: string;
}

export interface OpenOrder {
  coin: string;
  side: 'B' | 'A'; // B = buy, A = ask/sell
  limitPx: string;
  sz: string;
  oid: number;
  timestamp: number;
  origSz: string;
  cloid?: string;
  orderType: string;
  reduceOnly: boolean;
  triggerPx?: string;
  triggerCondition?: string;
  isTrigger: boolean;
}

export interface Fill {
  coin: string;
  px: string;
  sz: string;
  side: string;
  time: number;
  closedPnl: string;
  dir: string;
  hash: string;
  fee: string;
  oid: number;
  crossed: boolean;
  liquidation?: boolean;
}

export interface FundingHistory {
  coin: string;
  fundingRate: string;
  premium: string;
  time: number;
}

export interface UserFunding {
  coin: string;
  fundingRate: string;
  szi: string;
  usdc: string;
  time: number;
}

export interface Meta {
  universe: Array<{
    name: string;
    szDecimals: number;
    maxLeverage: number;
    onlyIsolated: boolean;
  }>;
}

export interface AssetContext {
  dayNtlVlm: string;
  funding: string;
  impactPxs: [string, string];
  markPx: string;
  midPx: string;
  openInterest: string;
  oraclePx: string;
  premium: string;
  prevDayPx: string;
}

export interface Candle {
  t: number; // timestamp
  o: string; // open
  h: string; // high
  l: string; // low
  c: string; // close
  v: string; // volume
  n: number; // number of trades
}

export interface L2Book {
  coin: string;
  levels: Array<Array<{ px: string; sz: string; n: number }>>;
  time: number;
}

export interface UserNonFundingLedgerUpdate {
  time: number;
  hash: string;
  delta: {
    type: string;
    usdc: string;
    // liquidation specific
    coin?: string;
    szi?: string;
    px?: string;
  };
}

// ============================================
// Core API Functions
// ============================================

async function apiCall<T>(body: object): Promise<T | null> {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      logger.error(`API error: ${response.status} ${response.statusText}`);
      return null;
    }

    return await response.json() as T;
  } catch (error) {
    logger.error('API call failed', error);
    return null;
  }
}

// ============================================
// User Data Endpoints
// ============================================

/**
 * Get user's clearinghouse state (positions + account info)
 */
export async function getClearinghouseState(address: string): Promise<ClearinghouseState | null> {
  return apiCall<ClearinghouseState>({
    type: 'clearinghouseState',
    user: address,
  });
}

/**
 * Get user's open orders
 */
export async function getOpenOrders(address: string): Promise<OpenOrder[]> {
  const result = await apiCall<OpenOrder[]>({
    type: 'openOrders',
    user: address,
  });
  return result || [];
}

/**
 * Get user's recent fills (trades)
 */
export async function getUserFills(
  address: string,
  startTime?: number
): Promise<Fill[]> {
  const body: { type: string; user: string; startTime?: number } = {
    type: 'userFills',
    user: address,
  };
  if (startTime) body.startTime = startTime;
  
  const result = await apiCall<Fill[]>(body);
  return result || [];
}

/**
 * Get user's funding payments
 */
export async function getUserFunding(
  address: string,
  startTime?: number,
  endTime?: number
): Promise<UserFunding[]> {
  const body: { type: string; user: string; startTime?: number; endTime?: number } = {
    type: 'userFunding',
    user: address,
  };
  if (startTime) body.startTime = startTime;
  if (endTime) body.endTime = endTime;
  
  const result = await apiCall<UserFunding[]>(body);
  return result || [];
}

/**
 * Get user's non-funding ledger updates (deposits, withdrawals, liquidations)
 */
export async function getUserLedgerUpdates(
  address: string,
  startTime?: number
): Promise<UserNonFundingLedgerUpdate[]> {
  const body: { type: string; user: string; startTime?: number } = {
    type: 'userNonFundingLedgerUpdates',
    user: address,
  };
  if (startTime) body.startTime = startTime;
  
  const result = await apiCall<UserNonFundingLedgerUpdate[]>(body);
  return result || [];
}

// ============================================
// Market Data Endpoints
// ============================================

/**
 * Get all mid prices
 */
export async function getAllMids(): Promise<Record<string, string>> {
  const result = await apiCall<Record<string, string>>({ type: 'allMids' });
  return result || {};
}

/**
 * Get single mid price
 */
export async function getMidPrice(coin: string): Promise<number | null> {
  const mids = await getAllMids();
  return mids[coin] ? parseFloat(mids[coin]) : null;
}

/**
 * Get market metadata
 */
export async function getMeta(): Promise<Meta | null> {
  return apiCall<Meta>({ type: 'meta' });
}

/**
 * Get asset contexts (funding, OI, etc.)
 */
export async function getAssetContexts(): Promise<AssetContext[]> {
  // Returns [meta, contexts] tuple
  const result = await apiCall<[Meta, AssetContext[]]>({ type: 'metaAndAssetCtxs' });
  return result ? result[1] : [];
}

/**
 * Get funding history for a coin
 */
export async function getFundingHistory(
  coin: string,
  startTime: number,
  endTime?: number
): Promise<FundingHistory[]> {
  const body: { type: string; coin: string; startTime: number; endTime?: number } = {
    type: 'fundingHistory',
    coin,
    startTime,
  };
  if (endTime) body.endTime = endTime;
  
  const result = await apiCall<FundingHistory[]>(body);
  return result || [];
}

/**
 * Get candlestick data
 */
export async function getCandles(
  coin: string,
  interval: string, // '1m', '5m', '15m', '1h', '4h', '1d'
  startTime: number,
  endTime?: number
): Promise<Candle[]> {
  const body: { type: string; req: { coin: string; interval: string; startTime: number; endTime?: number } } = {
    type: 'candleSnapshot',
    req: {
      coin,
      interval,
      startTime,
    },
  };
  if (endTime) body.req.endTime = endTime;
  
  const result = await apiCall<Candle[]>(body);
  return result || [];
}

/**
 * Get L2 order book
 */
export async function getL2Book(coin: string, nSigFigs?: number): Promise<L2Book | null> {
  return apiCall<L2Book>({
    type: 'l2Book',
    coin,
    nSigFigs: nSigFigs || 5,
  });
}

// ============================================
// Derived/Calculated Functions
// ============================================

/**
 * Calculate ATR (Average True Range) from candles
 */
export async function calculateATR(
  coin: string,
  period: number = 14
): Promise<{ atr: number; atrPct: number } | null> {
  const endTime = Date.now();
  const startTime = endTime - (period + 5) * 24 * 60 * 60 * 1000; // Extra days for buffer
  
  const candles = await getCandles(coin, '1d', startTime, endTime);
  
  if (candles.length < period + 1) {
    logger.warn(`Not enough candles for ${coin} ATR calculation`);
    return null;
  }

  // Calculate True Range for each candle
  const trueRanges: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const high = parseFloat(candles[i].h);
    const low = parseFloat(candles[i].l);
    const prevClose = parseFloat(candles[i - 1].c);
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    
    trueRanges.push(tr);
  }

  // Calculate ATR (simple moving average of TR)
  const recentTRs = trueRanges.slice(-period);
  const atr = recentTRs.reduce((sum, tr) => sum + tr, 0) / period;
  
  // Get current price for percentage
  const currentPrice = parseFloat(candles[candles.length - 1].c);
  const atrPct = (atr / currentPrice) * 100;

  return { atr, atrPct };
}

/**
 * Get comprehensive position data with open orders
 */
export async function getFullPositionData(address: string): Promise<{
  positions: Position[];
  openOrders: OpenOrder[];
  accountValue: number;
  marginUsed: number;
} | null> {
  const [state, orders] = await Promise.all([
    getClearinghouseState(address),
    getOpenOrders(address),
  ]);

  if (!state) return null;

  const positions = state.assetPositions
    .map(ap => ap.position)
    .filter(p => parseFloat(p.szi) !== 0);

  return {
    positions,
    openOrders: orders,
    accountValue: parseFloat(state.marginSummary.accountValue),
    marginUsed: parseFloat(state.marginSummary.totalMarginUsed),
  };
}

/**
 * Get current funding rates for all assets
 */
export async function getCurrentFundingRates(): Promise<Map<string, {
  fundingRate: number;
  premium: number;
  openInterest: number;
  nextFundingTime: Date;
}>> {
  const contexts = await getAssetContexts();
  const meta = await getMeta();
  
  const rates = new Map();
  
  if (!contexts || !meta) return rates;

  for (let i = 0; i < contexts.length; i++) {
    const ctx = contexts[i];
    const coin = meta.universe[i]?.name;
    
    if (coin && ctx) {
      rates.set(coin, {
        fundingRate: parseFloat(ctx.funding),
        premium: parseFloat(ctx.premium),
        openInterest: parseFloat(ctx.openInterest),
        // Funding happens every 8 hours
        nextFundingTime: new Date(Math.ceil(Date.now() / (8 * 60 * 60 * 1000)) * 8 * 60 * 60 * 1000),
      });
    }
  }

  return rates;
}

/**
 * Calculate net funding for a user over a period
 */
export async function calculateNetFunding(
  address: string,
  days: number
): Promise<{
  netFunding: number;
  byAsset: Map<string, number>;
  avgRate: number;
}> {
  const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
  const funding = await getUserFunding(address, startTime);

  let netFunding = 0;
  const byAsset = new Map<string, number>();
  let totalRateSum = 0;

  for (const f of funding) {
    const usdc = parseFloat(f.usdc);
    netFunding += usdc;
    
    const current = byAsset.get(f.coin) || 0;
    byAsset.set(f.coin, current + usdc);
    
    totalRateSum += parseFloat(f.fundingRate);
  }

  return {
    netFunding,
    byAsset,
    avgRate: funding.length > 0 ? totalRateSum / funding.length : 0,
  };
}

/**
 * Check if user was liquidated recently
 */
export async function checkRecentLiquidations(
  address: string,
  hours: number = 24
): Promise<{ wasLiquidated: boolean; liquidations: UserNonFundingLedgerUpdate[] }> {
  const startTime = Date.now() - hours * 60 * 60 * 1000;
  const updates = await getUserLedgerUpdates(address, startTime);

  const liquidations = updates.filter(u => u.delta.type === 'liquidation');

  return {
    wasLiquidated: liquidations.length > 0,
    liquidations,
  };
}

/**
 * Get best bid/ask from order book
 */
export async function getBestPrices(coin: string): Promise<{
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPct: number;
} | null> {
  const book = await getL2Book(coin);
  
  if (!book || !book.levels || book.levels.length < 2) return null;
  
  const bids = book.levels[0];
  const asks = book.levels[1];
  
  if (!bids.length || !asks.length) return null;
  
  const bestBid = parseFloat(bids[0].px);
  const bestAsk = parseFloat(asks[0].px);
  const spread = bestAsk - bestBid;
  const midPrice = (bestBid + bestAsk) / 2;
  const spreadPct = (spread / midPrice) * 100;

  return { bestBid, bestAsk, spread, spreadPct };
}

export default {
  // User data
  getClearinghouseState,
  getOpenOrders,
  getUserFills,
  getUserFunding,
  getUserLedgerUpdates,
  getFullPositionData,
  
  // Market data
  getAllMids,
  getMidPrice,
  getMeta,
  getAssetContexts,
  getFundingHistory,
  getCandles,
  getL2Book,
  getCurrentFundingRates,
  getBestPrices,
  
  // Calculated
  calculateATR,
  calculateNetFunding,
  checkRecentLiquidations,
};