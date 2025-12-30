// Simple logger utility

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL as keyof typeof LOG_LEVELS] || LOG_LEVELS.info;

function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function formatMessage(level: string, module: string, message: string): string {
  return `[${formatTimestamp()}] [${level.toUpperCase().padEnd(5)}] [${module}] ${message}`;
}

export function createLogger(module: string) {
  return {
    debug: (message: string, ...args: unknown[]) => {
      if (currentLevel <= LOG_LEVELS.debug) {
        console.log(formatMessage('debug', module, message), ...args);
      }
    },
    info: (message: string, ...args: unknown[]) => {
      if (currentLevel <= LOG_LEVELS.info) {
        console.log(formatMessage('info', module, message), ...args);
      }
    },
    warn: (message: string, ...args: unknown[]) => {
      if (currentLevel <= LOG_LEVELS.warn) {
        console.warn(formatMessage('warn', module, message), ...args);
      }
    },
    error: (message: string, ...args: unknown[]) => {
      if (currentLevel <= LOG_LEVELS.error) {
        console.error(formatMessage('error', module, message), ...args);
      }
    },
  };
}

export default { createLogger };