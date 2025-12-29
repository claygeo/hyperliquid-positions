// Trade Stream - WebSocket listener for discovering wallets
// Subscribes to trades on major coins and captures wallet addresses

import WebSocket from 'ws';
import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';

const logger = createLogger('trade-stream');

// Major coins to monitor
const MONITORED_COINS = ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'DOGE', 'SUI', 'AVAX', 'LINK', 'BNB'];

const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const RECONNECT_DELAY = 5000;
const MIN_TRADE_VALUE = 10000; // Only care about trades > $10k

let ws: WebSocket | null = null;
let isConnected = false;
let reconnectTimeout: NodeJS.Timeout | null = null;
let discoveredCount = 0;
let tradesProcessed = 0;

interface WsTrade {
  coin: string;
  side: string;
  px: string;
  sz: string;
  hash: string;
  time: number;
  tid: number;
  users: [string, string]; // [buyer, seller]
}

interface TradeMessage {
  channel: string;
  data: WsTrade[];
}

async function processWallet(address: string, coin: string, tradeValue: number): Promise<void> {
  // Skip if trade too small
  if (tradeValue < MIN_TRADE_VALUE) return;
  
  // Normalize address
  const normalizedAddress = address.toLowerCase();
  
  // Check if we already know this wallet
  const existing = await db.client
    .from('discovered_wallets')
    .select('address, trade_count')
    .eq('address', normalizedAddress)
    .single();
  
  if (existing.data) {
    // Update existing wallet
    await db.client
      .from('discovered_wallets')
      .update({
        last_seen_at: new Date().toISOString(),
        trade_count: existing.data.trade_count + 1,
      })
      .eq('address', normalizedAddress);
  } else {
    // New wallet discovered
    const result = await db.client
      .from('discovered_wallets')
      .insert({
        address: normalizedAddress,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        trade_count: 1,
        needs_analysis: true,
      });
    
    if (!result.error) {
      discoveredCount++;
      logger.info('NEW WALLET: ' + normalizedAddress.slice(0, 10) + '... | ' + coin + ' | $' + Math.round(tradeValue));
    }
  }
}

function processTrade(trade: WsTrade): void {
  tradesProcessed++;
  
  const price = parseFloat(trade.px);
  const size = parseFloat(trade.sz);
  const value = price * size;
  
  // Process both buyer and seller
  if (trade.users && trade.users.length === 2) {
    const [buyer, seller] = trade.users;
    
    // Process buyer
    if (buyer && buyer.startsWith('0x')) {
      processWallet(buyer, trade.coin, value);
    }
    
    // Process seller
    if (seller && seller.startsWith('0x')) {
      processWallet(seller, trade.coin, value);
    }
  }
}

function connect(): void {
  if (ws) {
    ws.terminate();
  }
  
  logger.info('Connecting to Hyperliquid WebSocket...');
  
  ws = new WebSocket(WS_URL);
  
  ws.on('open', () => {
    isConnected = true;
    logger.info('WebSocket connected');
    
    // Subscribe to trades for each monitored coin
    for (const coin of MONITORED_COINS) {
      const subscribeMsg = {
        method: 'subscribe',
        subscription: {
          type: 'trades',
          coin: coin,
        },
      };
      
      ws?.send(JSON.stringify(subscribeMsg));
      logger.info('Subscribed to ' + coin + ' trades');
    }
  });
  
  ws.on('message', (data: WebSocket.Data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle trade messages
      if (message.channel === 'trades' && message.data) {
        const trades = message.data as WsTrade[];
        for (const trade of trades) {
          processTrade(trade);
        }
      }
    } catch (err) {
      // Ignore parse errors for subscription confirmations
    }
  });
  
  ws.on('error', (error) => {
    logger.error('WebSocket error', error);
  });
  
  ws.on('close', () => {
    isConnected = false;
    logger.warn('WebSocket disconnected, reconnecting in ' + (RECONNECT_DELAY / 1000) + 's...');
    
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    
    reconnectTimeout = setTimeout(connect, RECONNECT_DELAY);
  });
}

export function startTradeStream(): void {
  logger.info('Starting trade stream...');
  logger.info('Monitoring coins: ' + MONITORED_COINS.join(', '));
  logger.info('Minimum trade value: $' + MIN_TRADE_VALUE);
  
  connect();
  
  // Log stats periodically
  setInterval(() => {
    logger.info('Trade stream stats | Trades processed: ' + tradesProcessed + ' | New wallets: ' + discoveredCount);
  }, 60000);
}

export function stopTradeStream(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }
  
  if (ws) {
    ws.terminate();
    ws = null;
  }
  
  isConnected = false;
  logger.info('Trade stream stopped');
}

export function isStreamConnected(): boolean {
  return isConnected;
}

export default { startTradeStream, stopTradeStream, isStreamConnected };