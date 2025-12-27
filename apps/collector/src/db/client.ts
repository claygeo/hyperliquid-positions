// Supabase client for collector

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import CONFIG from '../config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('db');

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    client = createClient(
      CONFIG.supabase.url,
      CONFIG.supabase.serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
    logger.info('Supabase client initialized');
  }
  return client;
}

export const db = {
  get client() {
    return getSupabaseClient();
  },
};

export default db;
