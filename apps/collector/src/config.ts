// Configuration for the collector

const CONFIG = {
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
  logLevel: process.env.LOG_LEVEL || 'info',
  nodeEnv: process.env.NODE_ENV || 'development',
};

export function validateConfig(): void {
  if (!CONFIG.supabase.url) {
    throw new Error('SUPABASE_URL is required');
  }
  if (!CONFIG.supabase.serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY is required');
  }
}

export default CONFIG;