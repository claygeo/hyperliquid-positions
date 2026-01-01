// WebSocket Stream V4 - Real-time fill tracking for quality traders
// Enhanced with:
// - Deduplication to prevent logging same fills multiple times
// - Exit detection when traders close positions
// - Latency tracking with explicit detected_at timestamp

import WebSocket from 'ws';
import { createLogger } from '../utils/logger.js';
import db from '../db/client.js';
import { config } from '../config.js';

const logger = createLogger('ws-stream');

const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const RECONNECT_DELAY = 5000;
const HEARTBEAT_INTERVAL = 30000;

// ============================================
// State
// ============================================

let ws: WebSocket | null = null;
let isConnected = false;
let reconnectTimeout: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let subscribedAddresses: Set<string> = new Set();

// Deduplication: track recent fill hashes
const recentFillHashes = new Set<string>();
const MAX_RECENT_FILLS = 1000;

// Stats
let fillsReceived = 0;
let lastFillTime: Date | null = null;

// Event handlers
type FillHandler = (fill: RealtimeFill) => void | Promise<void>;
const fillHandlers: FillHandler[] = [];

// ============================================
// Types
// ============================================

interface WsFill {
  coin: string;
  px: string;
  sz: string;
  side: string;
  time: number;
  closedPnl: string;
  hash: string;
  fee: string;
  oid: number;
  crossed: boolean;
  liquidation?: boolean;
}

interface WsMessage {
  channel: string;
  data: {
    user: string;
    fills: WsFill[];
  };
}

export interface RealtimeFill {
  address: string;
  coin: string;
  side: 'buy' | 'sell';
  size: number;
  price: number;
  closedPnl: number;
  fee: number;
  isLiquidation: boolean;
  fillTime: Date;
  txHash: string;
  qualityTier?: 'elite' | 'good';
  isExit?: boolean;
}

// ============================================
// Exit Detection
// ============================================

/**
 * Detect if this fill represents a position exit/reduction
 * and link it to any active signal
 */
async function processTraderExit(fill: RealtimeFill): Promise<void> {
  try {
    // Only process if there's closed PnL (indicates position reduction/close)
    if (fill.closedPnl === 0) return;

    // Determine exit direction based on side
    // If trader bought to close, they were short; if sold to close, they were long
    const exitDirection = fill.side === 'buy' ? 'short' : 'long';

    // Find matching active signal
    const { data: signal } = await db.client
      .from('quality_signals')
      .select('id, coin, direction, traders')
      .eq('coin', fill.coin)
      .eq('direction', exitDirection)
      .eq('is_active', true)
      .single();

    if (!signal) return;

    // Check if this trader was part of the signal
    const traders = signal.traders as Array<{ address: string }> || [];
    const wasInSignal = traders.some(t => 
      t.address.toLowerCase() === fill.address.toLowerCase()
    );

    if (!wasInSignal) return;

    // Record the exit
    await db.client.from('signal_trader_exits').insert({
      signal_id: signal.id,
      address: fill.address,
      coin: fill.coin,
      direction: exitDirection,
      exit_price: fill.price,
      exit_size: fill.size,
      exit_pnl: fill.closedPnl,
      exit_time: fill.fillTime.toISOString(),
      quality_tier: fill.qualityTier,
    });

    const pnlEmoji = fill.closedPnl >= 0 ? '💰' : '📉';
    const tierTag = fill.qualityTier ? `[${fill.qualityTier.toUpperCase()}]` : '';
    
    logger.info(
      `${pnlEmoji} TRADER EXIT ${tierTag}: ${fill.address.slice(0, 10)}... ` +
      `closed ${fill.size.toFixed(2)} ${fill.coin} ${exitDirection.toUpperCase()} ` +
      `@ $${fill.price.toFixed(4)} | PnL: ${fill.closedPnl >= 0 ? '+' : ''}$${fill.closedPnl.toFixed(2)}`
    );

    // Check if we should close the signal (majority of traders exited)
    await checkSignalForClose(signal.id);

  } catch (error) {
    // Don't log errors for normal cases
  }
}

/**
 * Check if a signal should be closed due to traders exiting
 */
async function checkSignalForClose(signalId: number): Promise<void> {
  try {
    // Get signal details
    const { data: signal } = await db.client
      .from('quality_signals')
      .select('coin, direction, elite_count, good_count, total_traders')
      .eq('id', signalId)
      .single();

    if (!signal) return;

    // Count exits for this signal
    const { count: exitCount } = await db.client
      .from('signal_trader_exits')
      .select('id', { count: 'exact' })
      .eq('signal_id', signalId);

    const totalTraders = signal.elite_count + signal.good_count;
    const exitRatio = (exitCount || 0) / totalTraders;

    // If more than 50% of traders have exited, close the signal
    if (exitRatio >= 0.5) {
      logger.warn(
        `⚠️ MAJORITY EXIT: ${signal.coin} ${signal.direction.toUpperCase()} | ` +
        `${exitCount}/${totalTraders} traders exited (${(exitRatio * 100).toFixed(0)}%)`
      );

      // The signal will be closed by signal-tracker when it detects is_active = false
      // We just invalidate it here
      await db.client
        .from('quality_signals')
        .update({
          invalidated: true,
          invalidation_reason: `majority_exit_${exitCount}_of_${totalTraders}`,
        })
        .eq('id', signalId);
    }
  } catch (error) {
    logger.error('checkSignalForClose failed', error);
  }
}

// ============================================
// Core Functions
// ============================================

/**
 * Check if fill was already processed (deduplication)
 */
function isDuplicateFill(hash: string, oid: number): boolean {
  const key = `${hash}-${oid}`;
  if (recentFillHashes.has(key)) {
    return true;
  }
  
  // Add to recent fills
  recentFillHashes.add(key);
  
  // Cleanup old entries if too many
  if (recentFillHashes.size > MAX_RECENT_FILLS) {
    const iterator = recentFillHashes.values();
    for (let i = 0; i < 100; i++) {
      const oldest = iterator.next().value;
      if (oldest) recentFillHashes.delete(oldest);
    }
  }
  
  return false;
}

/**
 * Process incoming fill from WebSocket
 */
async function processFill(address: string, fill: WsFill): Promise<void> {
  // Deduplicate
  if (isDuplicateFill(fill.hash, fill.oid)) {
    return;
  }

  const detectedAt = new Date();
  fillsReceived++;
  lastFillTime = detectedAt;

  const realtimeFill: RealtimeFill = {
    address: address.toLowerCase(),
    coin: fill.coin,
    side: fill.side === 'B' ? 'buy' : 'sell',
    size: parseFloat(fill.sz),
    price: parseFloat(fill.px),
    closedPnl: parseFloat(fill.closedPnl || '0'),
    fee: parseFloat(fill.fee || '0'),
    isLiquidation: fill.liquidation || false,
    fillTime: new Date(fill.time),
    txHash: fill.hash,
    isExit: parseFloat(fill.closedPnl || '0') !== 0,
  };

  // Get trader quality tier
  const { data: trader } = await db.client
    .from('trader_quality')
    .select('quality_tier')
    .eq('address', address.toLowerCase())
    .single();

  if (trader && (trader.quality_tier === 'elite' || trader.quality_tier === 'good')) {
    realtimeFill.qualityTier = trader.quality_tier;
  }

  // Save to realtime_fills table with explicit detected_at
  try {
    await db.client.from('realtime_fills').upsert({
      address: realtimeFill.address,
      coin: realtimeFill.coin,
      side: realtimeFill.side,
      size: realtimeFill.size,
      price: realtimeFill.price,
      closed_pnl: realtimeFill.closedPnl,
      fee: realtimeFill.fee,
      is_liquidation: realtimeFill.isLiquidation,
      fill_time: realtimeFill.fillTime.toISOString(),
      tx_hash: realtimeFill.txHash,
      detected_at: detectedAt.toISOString(),
      processed: false,
    }, { onConflict: 'tx_hash' });
  } catch (error) {
    // Ignore duplicate errors
  }

  // Log significant fills
  const value = realtimeFill.size * realtimeFill.price;
  if (value >= 5000 || realtimeFill.qualityTier) {
    const tierTag = realtimeFill.qualityTier 
      ? `[${realtimeFill.qualityTier.toUpperCase()}]` 
      : '';
    const pnlTag = realtimeFill.closedPnl !== 0 
      ? ` | PnL: ${realtimeFill.closedPnl >= 0 ? '+' : ''}$${realtimeFill.closedPnl.toFixed(0)}` 
      : '';
    const exitTag = realtimeFill.isExit ? ' [EXIT]' : '';
    
    logger.info(
      `${tierTag} FILL${exitTag}: ${address.slice(0, 8)}... ${realtimeFill.side.toUpperCase()} ` +
      `${realtimeFill.size.toFixed(2)} ${realtimeFill.coin} @ $${realtimeFill.price.toFixed(2)} ` +
      `($${value.toFixed(0)})${pnlTag}`
    );
  }

  // Process exit if this is a position close
  if (realtimeFill.isExit && realtimeFill.qualityTier) {
    await processTraderExit(realtimeFill);
  }

  // Call registered handlers
  for (const handler of fillHandlers) {
    try {
      await handler(realtimeFill);
    } catch (error) {
      logger.error('Fill handler error', error);
    }
  }
}

/**
 * Subscribe to fills for an address
 */
function subscribeToAddress(address: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    logger.warn('Cannot subscribe: WebSocket not connected');
    return;
  }

  const normalizedAddress = address.toLowerCase();
  
  if (subscribedAddresses.has(normalizedAddress)) {
    return;
  }

  const subscribeMsg = {
    method: 'subscribe',
    subscription: {
      type: 'userFills',
      user: normalizedAddress,
    },
  };

  ws.send(JSON.stringify(subscribeMsg));
  subscribedAddresses.add(normalizedAddress);
  logger.debug(`Subscribed to fills: ${normalizedAddress.slice(0, 10)}...`);
}

/**
 * Unsubscribe from fills for an address
 */
function unsubscribeFromAddress(address: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  const normalizedAddress = address.toLowerCase();
  
  if (!subscribedAddresses.has(normalizedAddress)) {
    return;
  }

  const unsubscribeMsg = {
    method: 'unsubscribe',
    subscription: {
      type: 'userFills',
      user: normalizedAddress,
    },
  };

  ws.send(JSON.stringify(unsubscribeMsg));
  subscribedAddresses.delete(normalizedAddress);
  logger.debug(`Unsubscribed from fills: ${normalizedAddress.slice(0, 10)}...`);
}

/**
 * Load and subscribe to all quality traders
 */
async function subscribeToQualityTraders(): Promise<void> {
  const { data: traders, error } = await db.client
    .from('trader_quality')
    .select('address')
    .eq('is_tracked', true)
    .in('quality_tier', ['elite', 'good']);

  if (error || !traders) {
    logger.error('Failed to load quality traders', error);
    return;
  }

  logger.info(`Subscribing to ${traders.length} quality traders...`);

  for (const trader of traders) {
    subscribeToAddress(trader.address);
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  logger.info(`Subscribed to ${subscribedAddresses.size} traders`);
}

/**
 * Send heartbeat to keep connection alive
 */
function sendHeartbeat(): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ method: 'ping' }));
  }
}

/**
 * Connect to WebSocket
 */
function connect(): void {
  if (ws) {
    ws.terminate();
  }

  // Clear deduplication cache on reconnect
  recentFillHashes.clear();

  logger.info('Connecting to Hyperliquid WebSocket...');
  
  ws = new WebSocket(WS_URL);

  ws.on('open', async () => {
    isConnected = true;
    logger.info('WebSocket connected');
    
    await subscribeToQualityTraders();
    
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
  });

  ws.on('message', (data: WebSocket.Data) => {
    try {
      const message = JSON.parse(data.toString()) as WsMessage;
      
      if (message.channel === 'userFills' && message.data?.fills) {
        const address = message.data.user;
        for (const fill of message.data.fills) {
          processFill(address, fill);
        }
      }
    } catch {
      // Ignore parse errors for pong/subscription confirmations
    }
  });

  ws.on('error', (error) => {
    logger.error('WebSocket error', error);
  });

  ws.on('close', () => {
    isConnected = false;
    subscribedAddresses.clear();
    
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    
    logger.warn(`WebSocket disconnected, reconnecting in ${RECONNECT_DELAY / 1000}s...`);
    
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    
    reconnectTimeout = setTimeout(connect, RECONNECT_DELAY);
  });
}

// ============================================
// Public API
// ============================================

export function startWebSocketStream(): void {
  logger.info('Starting WebSocket stream V4 with exit detection...');
  connect();
  
  // Refresh subscriptions every 5 minutes
  setInterval(async () => {
    if (isConnected) {
      await refreshSubscriptions();
    }
  }, 5 * 60 * 1000);
}

export function stopWebSocketStream(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  
  if (ws) {
    ws.terminate();
    ws = null;
  }
  
  isConnected = false;
  subscribedAddresses.clear();
  recentFillHashes.clear();
  logger.info('WebSocket stream stopped');
}

export async function refreshSubscriptions(): Promise<void> {
  const { data: traders } = await db.client
    .from('trader_quality')
    .select('address')
    .eq('is_tracked', true)
    .in('quality_tier', ['elite', 'good']);

  if (!traders) return;

  const currentAddresses = new Set(traders.map(t => t.address.toLowerCase()));
  
  for (const address of currentAddresses) {
    if (!subscribedAddresses.has(address)) {
      subscribeToAddress(address);
    }
  }
  
  for (const address of subscribedAddresses) {
    if (!currentAddresses.has(address)) {
      unsubscribeFromAddress(address);
    }
  }
}

export function onFill(handler: FillHandler): void {
  fillHandlers.push(handler);
}

export function offFill(handler: FillHandler): void {
  const index = fillHandlers.indexOf(handler);
  if (index > -1) {
    fillHandlers.splice(index, 1);
  }
}

export function getStreamStats(): {
  isConnected: boolean;
  subscribedCount: number;
  fillsReceived: number;
  lastFillTime: Date | null;
} {
  return {
    isConnected,
    subscribedCount: subscribedAddresses.size,
    fillsReceived,
    lastFillTime,
  };
}

export function subscribeTrader(address: string): void {
  subscribeToAddress(address);
}

export function isStreamConnected(): boolean {
  return isConnected;
}

export default {
  startWebSocketStream,
  stopWebSocketStream,
  refreshSubscriptions,
  onFill,
  offFill,
  getStreamStats,
  subscribeTrader,
  isStreamConnected,
};