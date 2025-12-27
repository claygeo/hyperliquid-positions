// Formatting utilities

/**
 * Shorten an Ethereum address for display
 * 0x1234...5678
 */
export function shortenAddress(address: string, chars = 4): string {
  if (!address) return '';
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Format a number as currency
 */
export function formatCurrency(
  value: number,
  options: {
    currency?: string;
    decimals?: number;
    compact?: boolean;
  } = {}
): string {
  const { currency = 'USD', decimals = 2, compact = false } = options;
  
  if (compact) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: decimals,
    }).format(value);
  }
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Format a number with commas
 */
export function formatNumber(
  value: number,
  options: {
    decimals?: number;
    compact?: boolean;
  } = {}
): string {
  const { decimals = 2, compact = false } = options;
  
  if (compact) {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: decimals,
    }).format(value);
  }
  
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Format a percentage
 */
export function formatPercent(
  value: number,
  options: {
    decimals?: number;
    showSign?: boolean;
  } = {}
): string {
  const { decimals = 2, showSign = false } = options;
  
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: showSign ? 'exceptZero' : 'auto',
  }).format(value);
  
  return formatted;
}

/**
 * Format a score (0-1) as display value (0-100)
 */
export function formatScore(score: number | null): string {
  if (score === null) return '-';
  return Math.round(score * 100).toString();
}

/**
 * Format PnL with color indication
 */
export function formatPnl(value: number, decimals = 2): {
  text: string;
  isPositive: boolean;
  isNegative: boolean;
} {
  const isPositive = value > 0;
  const isNegative = value < 0;
  const sign = isPositive ? '+' : '';
  
  return {
    text: `${sign}${formatCurrency(value, { decimals })}`,
    isPositive,
    isNegative,
  };
}

/**
 * Format position size with side indicator
 */
export function formatPosition(size: number, coin: string): string {
  const side = size > 0 ? 'Long' : 'Short';
  const absSize = Math.abs(size);
  return `${side} ${formatNumber(absSize)} ${coin}`;
}

/**
 * Format leverage
 */
export function formatLeverage(leverage: number): string {
  return `${leverage}x`;
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
