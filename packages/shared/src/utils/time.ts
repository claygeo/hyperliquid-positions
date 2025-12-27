// Time utilities

/**
 * Format relative time (e.g., "5 minutes ago")
 */
export function timeAgo(date: Date | string | number): string {
  const now = new Date();
  const past = new Date(date);
  const diffMs = now.getTime() - past.getTime();
  
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  
  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 4) return `${weeks}w ago`;
  return `${months}mo ago`;
}

/**
 * Format duration in minutes to human readable
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

/**
 * Get start of day (UTC)
 */
export function startOfDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Get start of hour
 */
export function startOfHour(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/**
 * Add time to date
 */
export function addTime(
  date: Date,
  amount: number,
  unit: 'minutes' | 'hours' | 'days'
): Date {
  const d = new Date(date);
  switch (unit) {
    case 'minutes':
      d.setTime(d.getTime() + amount * 60 * 1000);
      break;
    case 'hours':
      d.setTime(d.getTime() + amount * 60 * 60 * 1000);
      break;
    case 'days':
      d.setTime(d.getTime() + amount * 24 * 60 * 60 * 1000);
      break;
  }
  return d;
}

/**
 * Check if date is within last N minutes
 */
export function isWithinMinutes(date: Date, minutes: number): boolean {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return diffMs <= minutes * 60 * 1000;
}

/**
 * Check if date is today (UTC)
 */
export function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate()
  );
}

/**
 * Format date for display
 */
export function formatDate(
  date: Date | string | number,
  options: {
    includeTime?: boolean;
    includeSeconds?: boolean;
    relative?: boolean;
  } = {}
): string {
  const { includeTime = false, includeSeconds = false, relative = false } = options;
  const d = new Date(date);
  
  if (relative) {
    return timeAgo(d);
  }
  
  const dateStr = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
  
  if (!includeTime) return dateStr;
  
  const timeStr = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
    hour12: false,
  });
  
  return `${dateStr} ${timeStr}`;
}

/**
 * Parse ISO timestamp from Supabase
 */
export function parseTimestamp(timestamp: string): Date {
  return new Date(timestamp);
}

/**
 * Convert to ISO string for Supabase
 */
export function toISOString(date: Date): string {
  return date.toISOString();
}

/**
 * Get time until (for expiry countdowns)
 */
export function timeUntil(date: Date): string | null {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  
  if (diffMs <= 0) return null;
  
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle a function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
