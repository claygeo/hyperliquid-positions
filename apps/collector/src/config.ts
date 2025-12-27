// Environment configuration

import { config } from 'dotenv';

// Load environment variables
config();

export const CONFIG = {
  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
  
  // Hyperliquid API
  hyperliquid: {
    apiUrl: process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz',
    wsUrl: process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws',
  },
  
  // Collector settings
  collector: {
    positionPollIntervalMs: parseInt(process.env.POSITION_POLL_INTERVAL_MS || '60000', 10),
    scoreUpdateIntervalMs: parseInt(process.env.SCORE_UPDATE_INTERVAL_MS || '300000', 10),
    priceBackfillIntervalMs: parseInt(process.env.PRICE_BACKFILL_INTERVAL_MS || '60000', 10),
    maxTradesPerBatch: 1000,
    maxWalletsToTrack: 10000,
  },
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // Alerts
  alerts: {
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
  },
} as const;

// Validate required config
export function validateConfig(): void {
  const required = [
    ['SUPABASE_URL', CONFIG.supabase.url],
    ['SUPABASE_SERVICE_ROLE_KEY', CONFIG.supabase.serviceRoleKey],
  ];
  
  const missing = required.filter(([, value]) => !value);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.map(([name]) => name).join(', ')}`
    );
  }
}

export default CONFIG;
