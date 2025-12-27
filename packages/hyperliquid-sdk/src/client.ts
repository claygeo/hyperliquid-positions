// Hyperliquid API Client

import type {
  HLClearinghouseState,
  HLPortfolioResponse,
  HLAllMids,
  HLOpenOrder,
  HLFill,
  HLBook,
  HLMeta,
  HLUserRole,
  HLLedgerUpdate,
} from '@hyperliquid-tracker/shared';

export interface HyperliquidClientConfig {
  apiUrl?: string;
  timeout?: number;
}

const DEFAULT_API_URL = 'https://api.hyperliquid.xyz';
const DEFAULT_TIMEOUT = 30000;

export class HyperliquidClient {
  private apiUrl: string;
  private timeout: number;

  constructor(config: HyperliquidClientConfig = {}) {
    this.apiUrl = config.apiUrl || DEFAULT_API_URL;
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
  }

  private async post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.apiUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Info endpoint methods

  /**
   * Get all mid prices
   */
  async getAllMids(): Promise<HLAllMids> {
    return this.post<HLAllMids>('/info', { type: 'allMids' });
  }

  /**
   * Get user's clearinghouse state (positions, margin, etc)
   */
  async getClearinghouseState(user: string): Promise<HLClearinghouseState> {
    return this.post<HLClearinghouseState>('/info', {
      type: 'clearinghouseState',
      user,
    });
  }

  /**
   * Get user's portfolio history
   */
  async getPortfolio(user: string): Promise<HLPortfolioResponse> {
    return this.post<HLPortfolioResponse>('/info', {
      type: 'portfolio',
      user,
    });
  }

  /**
   * Get user's open orders
   */
  async getOpenOrders(user: string): Promise<HLOpenOrder[]> {
    return this.post<HLOpenOrder[]>('/info', {
      type: 'openOrders',
      user,
    });
  }

  /**
   * Get user's recent fills
   */
  async getUserFills(user: string): Promise<HLFill[]> {
    return this.post<HLFill[]>('/info', {
      type: 'userFills',
      user,
    });
  }

  /**
   * Get user's fills by time range
   */
  async getUserFillsByTime(
    user: string,
    startTime: number,
    endTime?: number
  ): Promise<HLFill[]> {
    return this.post<HLFill[]>('/info', {
      type: 'userFillsByTime',
      user,
      startTime,
      endTime,
    });
  }

  /**
   * Get user's funding history
   */
  async getUserFunding(
    user: string,
    startTime: number,
    endTime?: number
  ): Promise<unknown[]> {
    return this.post<unknown[]>('/info', {
      type: 'userFunding',
      user,
      startTime,
      endTime,
    });
  }

  /**
   * Get user's non-funding ledger updates (transfers, etc)
   */
  async getUserNonFundingLedgerUpdates(user: string): Promise<HLLedgerUpdate[]> {
    return this.post<HLLedgerUpdate[]>('/info', {
      type: 'userNonFundingLedgerUpdates',
      user,
    });
  }

  /**
   * Get L2 book snapshot
   */
  async getL2Book(coin: string, nSigFigs?: number): Promise<HLBook> {
    return this.post<HLBook>('/info', {
      type: 'l2Book',
      coin,
      nSigFigs,
    });
  }

  /**
   * Get candle data
   */
  async getCandles(
    coin: string,
    interval: string,
    startTime: number,
    endTime: number
  ): Promise<unknown[]> {
    return this.post<unknown[]>('/info', {
      type: 'candleSnapshot',
      req: {
        coin,
        interval,
        startTime,
        endTime,
      },
    });
  }

  /**
   * Get perpetuals metadata
   */
  async getMeta(): Promise<HLMeta> {
    return this.post<HLMeta>('/info', { type: 'meta' });
  }

  /**
   * Get user's role (user, agent, vault, subaccount)
   */
  async getUserRole(user: string): Promise<HLUserRole> {
    return this.post<HLUserRole>('/info', {
      type: 'userRole',
      user,
    });
  }

  /**
   * Get user's subaccounts
   */
  async getSubAccounts(user: string): Promise<unknown[]> {
    return this.post<unknown[]>('/info', {
      type: 'subAccounts',
      user,
    });
  }

  /**
   * Get vault details
   */
  async getVaultDetails(vaultAddress: string, user?: string): Promise<unknown> {
    return this.post<unknown>('/info', {
      type: 'vaultDetails',
      vaultAddress,
      user,
    });
  }

  /**
   * Get user's historical orders
   */
  async getHistoricalOrders(user: string): Promise<unknown[]> {
    return this.post<unknown[]>('/info', {
      type: 'historicalOrders',
      user,
    });
  }

  /**
   * Get leaderboard data
   */
  async getLeaderboard(): Promise<unknown> {
    return this.post<unknown>('/info', { type: 'leaderboard' });
  }
}

export default HyperliquidClient;
