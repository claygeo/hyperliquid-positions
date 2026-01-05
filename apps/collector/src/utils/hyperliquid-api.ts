// Hyperliquid API V5 - Comprehensive API Client
// Added: findPositionOpenTime() for accurate position timestamps

import { createLogger } from './logger.js';

const logger = createLogger('hyperliquid-api');

const API_URL = 'https://api.hyperliquid.xyz/info';

// ============================================
// Types
// ============================================

export interface Position {
  coin: string;
  szi: string;
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
  side: 'B' | 'A';
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
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: number;
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
    coin?: string;
    szi?: string;
    px?: string;
  };
}

// ============================================
// Core API Functions with Retry Logic
// ============================================

async function apiCall<T>(body: object, maxRetries = 3): Promise<T | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.status === 429) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.warn(`Rate limited (attempt ${attempt + 1}/${maxRetries}), waiting ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (!response.ok) {
        logger.error(`API error: ${response.status} ${response.statusText}`);
        return null;
      }

      return await response.json() as T;
    } catch (error) {
      logger.error(`API call failed (attempt ${attempt + 1}/${maxRetries})`, error);
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  return null;
}

// ============================================
// User Data Endpoints
// ============================================

export async function getClearinghouseState(address: string): Promise<ClearinghouseState | null> {
  return apiCall<ClearinghouseState>({
    type: 'clearinghouseState',
    user: address,
  });
}

export async function getOpenOrders(address: string): Promise<OpenOrder[]> {
  const result = await apiCall<OpenOrder[]>({
    type: 'openOrders',
    user: address,
  });
  return result || [];
}

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

export async function getAllMids(): Promise<Record<string, string>> {
  const result = await apiCall<Record<string, string>>({ type: 'allMids' });
  return result || {};
}

export async function getMidPrice(coin: string): Promise<number | null> {
  const mids = await getAllMids();
  return mids[coin] ? parseFloat(mids[coin]) : null;
}

export async function getMeta(): Promise<Meta | null> {
  return apiCall<Meta>({ type: 'meta' });
}

export async function getAssetContexts(): Promise<AssetContext[]> {
  const result = await apiCall<[Meta, AssetContext[]]>({ type: 'metaAndAssetCtxs' });
  return result ? result[1] : [];
}

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

export async function getCandles(
  coin: string,
  interval: string,
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

export async function getL2Book(coin: string, nSigFigs?: number): Promise<L2Book | null> {
  return apiCall<L2Book>({
    type: 'l2Book',
    coin,
    nSigFigs: nSigFigs || 5,
  });
}

// ============================================
// V5: Position Open Time Detection
// ============================================

/**
 * Find when a position was actually opened by querying fill history.
 * Returns the timestamp of the first "Open Long" or "Open Short" fill
 * that matches the current position direction.
 * 
 * @param address - Trader wallet address
 * @param coin - The asset (e.g., "BTC", "ETH")
 * @param direction - Current position direction ("long" or "short")
 * @param lookbackDays - How far back to search (default 30 days)
 * @returns Date of position open, or null if not found
 */
export async function findPositionOpenTime(
  address: string,
  coin: string,
  direction: 'long' | 'short',
  lookbackDays: number = 30
): Promise<{ openedAt: Date; entryPrice: number } | null> {
  try {
    const startTime = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const fills = await getUserFills(address, startTime);
    
    if (!fills || fills.length === 0) {
      logger.debug(`No fills found for ${address.slice(0, 8)}... ${coin}`);
      return null;
    }
    
    // Filter fills for this coin
    const coinFills = fills.filter(f => f.coin === coin);
    
    if (coinFills.length === 0) {
      logger.debug(`No ${coin} fills found for ${address.slice(0, 8)}...`);
      return null;
    }
    
    // Sort by time ascending (oldest first)
    coinFills.sort((a, b) => a.time - b.time);
    
    // The dir field contains: "Open Long", "Close Long", "Open Short", "Close Short"
    const openDir = direction === 'long' ? 'Open Long' : 'Open Short';
    const closeDir = direction === 'long' ? 'Close Long' : 'Close Short';
    
    // Walk through fills to find the most recent position open
    // We need to track opens and closes to find when the CURRENT position started
    let positionSize = 0;
    let lastOpenTime: number | null = null;
    let lastOpenPrice: number | null = null;
    
    for (const fill of coinFills) {
      const size = parseFloat(fill.sz);
      
      if (fill.dir.includes('Open')) {
        // Opening or adding to position
        if (fill.dir === openDir) {
          if (positionSize === 0) {
            // Fresh position open
            lastOpenTime = fill.time;
            lastOpenPrice = parseFloat(fill.px);
          }
          positionSize += size;
        } else {
          // Opening opposite direction - this would close existing and open new
          positionSize = size;
          lastOpenTime = fill.time;
          lastOpenPrice = parseFloat(fill.px);
        }
      } else if (fill.dir.includes('Close')) {
        // Closing position
        positionSize = Math.max(0, positionSize - size);
        
        if (positionSize === 0) {
          // Position fully closed, reset
          lastOpenTime = null;
          lastOpenPrice = null;
        }
      }
    }
    
    // If we found an open time and position is still open
    if (lastOpenTime && positionSize > 0) {
      logger.debug(
        `Found ${coin} ${direction} open time for ${address.slice(0, 8)}...: ` +
        `${new Date(lastOpenTime).toISOString()}`
      );
      return {
        openedAt: new Date(lastOpenTime),
        entryPrice: lastOpenPrice || 0,
      };
    }
    
    // Fallback: just find the most recent open fill for this direction
    const recentOpens = coinFills
      .filter(f => f.dir === openDir)
      .sort((a, b) => b.time - a.time);
    
    if (recentOpens.length > 0) {
      const mostRecent = recentOpens[0];
      logger.debug(
        `Using most recent ${coin} ${direction} fill for ${address.slice(0, 8)}...: ` +
        `${new Date(mostRecent.time).toISOString()}`
      );
      return {
        openedAt: new Date(mostRecent.time),
        entryPrice: parseFloat(mostRecent.px),
      };
    }
    
    logger.debug(`Could not determine open time for ${address.slice(0, 8)}... ${coin} ${direction}`);
    return null;
  } catch (error) {
    logger.error(`Error finding position open time for ${address.slice(0, 8)}... ${coin}`, error);
    return null;
  }
}

/**
 * Get the most recent size change (add/reduce) for a position
 */
export async function findLastSizeChange(
  address: string,
  coin: string,
  direction: 'long' | 'short',
  lookbackHours: number = 24
): Promise<{ timestamp: Date; type: 'increase' | 'decrease'; size: number; price: number } | null> {
  try {
    const startTime = Date.now() - lookbackHours * 60 * 60 * 1000;
    const fills = await getUserFills(address, startTime);
    
    if (!fills || fills.length === 0) return null;
    
    // Filter fills for this coin, most recent first
    const coinFills = fills
      .filter(f => f.coin === coin)
      .sort((a, b) => b.time - a.time);
    
    if (coinFills.length === 0) return null;
    
    const mostRecent = coinFills[0];
    const isIncrease = mostRecent.dir.includes('Open');
    
    return {
      timestamp: new Date(mostRecent.time),
      type: isIncrease ? 'increase' : 'decrease',
      size: parseFloat(mostRecent.sz),
      price: parseFloat(mostRecent.px),
    };
  } catch (error) {
    logger.error(`Error finding last size change for ${address.slice(0, 8)}... ${coin}`, error);
    return null;
  }
}

// ============================================
// Derived/Calculated Functions
// ============================================

export async function calculateATR(
  coin: string,
  period: number = 14
): Promise<{ atr: number; atrPct: number } | null> {
  const endTime = Date.now();
  const startTime = endTime - (period + 5) * 24 * 60 * 60 * 1000;
  
  const candles = await getCandles(coin, '1d', startTime, endTime);
  
  if (candles.length < period + 1) {
    logger.warn(`Not enough candles for ${coin} ATR calculation`);
    return null;
  }

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

  const recentTRs = trueRanges.slice(-period);
  const atr = recentTRs.reduce((sum, tr) => sum + tr, 0) / period;
  
  const currentPrice = parseFloat(candles[candles.length - 1].c);
  const atrPct = (atr / currentPrice) * 100;

  return { atr, atrPct };
}

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
        nextFundingTime: new Date(Math.ceil(Date.now() / (8 * 60 * 60 * 1000)) * 8 * 60 * 60 * 1000),
      });
    }
  }

  return rates;
}

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
  getClearinghouseState,
  getOpenOrders,
  getUserFills,
  getUserFunding,
  getUserLedgerUpdates,
  getFullPositionData,
  getAllMids,
  getMidPrice,
  getMeta,
  getAssetContexts,
  getFundingHistory,
  getCandles,
  getL2Book,
  getCurrentFundingRates,
  getBestPrices,
  calculateATR,
  calculateNetFunding,
  checkRecentLiquidations,
  findPositionOpenTime,
  findLastSizeChange,
};