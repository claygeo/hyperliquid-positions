// Hyperliquid API Response Types

// WebSocket Trade
export interface HLTrade {
  coin: string;
  side: 'B' | 'A'; // Buy or Ask (Sell)
  px: string;
  sz: string;
  hash: string;
  time: number;
  tid: number;
  users: [string, string]; // [buyer, seller]
}

// WebSocket Fill
export interface HLFill {
  coin: string;
  px: string;
  sz: string;
  side: 'B' | 'A';
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
  feeToken: string;
  builderFee?: string;
  liquidation?: {
    liquidatedUser?: string;
    markPx: number;
    method: 'market' | 'backstop';
  };
}

// User Fills WebSocket
export interface HLUserFills {
  isSnapshot?: boolean;
  user: string;
  fills: HLFill[];
}

// Position
export interface HLPosition {
  coin: string;
  szi: string; // Signed size (negative = short)
  leverage: {
    type: 'cross' | 'isolated';
    value: number;
  };
  entryPx: string;
  positionValue: string;
  unrealizedPnl: string;
  returnOnEquity: string;
  liquidationPx: string | null;
  marginUsed: string;
  maxTradeSzs: [string, string];
}

// Clearinghouse State (user's account)
export interface HLClearinghouseState {
  marginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  crossMarginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  crossMaintenanceMarginUsed: string;
  withdrawable: string;
  assetPositions: {
    position: HLPosition;
    type: 'oneWay';
  }[];
  time: number;
}

// Portfolio history
export interface HLPortfolio {
  accountValueHistory: [number, string][];
  pnlHistory: [number, string][];
  vlm: string;
}

export type HLPortfolioTimeframe = 'day' | 'week' | 'month' | 'allTime' | 'perpDay' | 'perpWeek' | 'perpMonth' | 'perpAllTime';

export type HLPortfolioResponse = [HLPortfolioTimeframe, HLPortfolio][];

// Order book
export interface HLBookLevel {
  px: string;
  sz: string;
  n: number;
}

export interface HLBook {
  coin: string;
  levels: [HLBookLevel[], HLBookLevel[]]; // [bids, asks]
  time: number;
}

// All mids (prices)
export interface HLAllMids {
  [coin: string]: string;
}

// User open orders
export interface HLOpenOrder {
  coin: string;
  limitPx: string;
  oid: number;
  side: 'B' | 'A';
  sz: string;
  timestamp: number;
}

// WebSocket subscription types
export type HLSubscriptionType =
  | 'allMids'
  | 'trades'
  | 'l2Book'
  | 'userFills'
  | 'userFundings'
  | 'orderUpdates'
  | 'notification'
  | 'webData2'
  | 'candle'
  | 'activeAssetCtx';

export interface HLSubscription {
  type: HLSubscriptionType;
  coin?: string;
  user?: string;
  interval?: string;
}

// WebSocket message
export interface HLWebSocketMessage {
  channel: string;
  data: unknown;
}

// Transfer types for cluster detection
export interface HLTransfer {
  type: 'internalTransfer' | 'subAccountTransfer';
  usdc: number;
  user: string;
  destination: string;
  fee?: number;
}

export interface HLLedgerUpdate {
  time: number;
  hash: string;
  delta: HLTransfer | { type: string; [key: string]: unknown };
}

// User role
export interface HLUserRole {
  role: 'user' | 'agent' | 'vault' | 'subAccount' | 'missing';
  data?: {
    user?: string;
    master?: string;
  };
}

// Meta info
export interface HLAssetInfo {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated: boolean;
}

export interface HLMeta {
  universe: HLAssetInfo[];
}
