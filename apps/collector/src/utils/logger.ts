// Simple logger utility

import CONFIG from '../config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LOG_LEVELS[CONFIG.logLevel as LogLevel] ?? LOG_LEVELS.info;

function formatMessage(level: LogLevel, context: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}${dataStr}`;
}

export function createLogger(context: string) {
  return {
    debug(message: string, data?: unknown) {
      if (currentLevel <= LOG_LEVELS.debug) {
        console.debug(formatMessage('debug', context, message, data));
      }
    },
    
    info(message: string, data?: unknown) {
      if (currentLevel <= LOG_LEVELS.info) {
        console.info(formatMessage('info', context, message, data));
      }
    },
    
    warn(message: string, data?: unknown) {
      if (currentLevel <= LOG_LEVELS.warn) {
        console.warn(formatMessage('warn', context, message, data));
      }
    },
    
    error(message: string, error?: unknown) {
      if (currentLevel <= LOG_LEVELS.error) {
        const errorData = error instanceof Error 
          ? { message: error.message, stack: error.stack }
          : error;
        console.error(formatMessage('error', context, message, errorData));
      }
    },
  };
}

export const logger = createLogger('main');
