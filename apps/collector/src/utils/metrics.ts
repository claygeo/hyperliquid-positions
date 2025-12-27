// Simple metrics tracking

import { createLogger } from './logger.js';

const logger = createLogger('metrics');

interface Metric {
  count: number;
  lastValue: number;
  sum: number;
  min: number;
  max: number;
  lastUpdated: Date;
}

class MetricsCollector {
  private metrics: Map<string, Metric> = new Map();
  private startTime: Date = new Date();

  increment(name: string, value = 1): void {
    const metric = this.getOrCreateMetric(name);
    metric.count += 1;
    metric.lastValue = value;
    metric.sum += value;
    metric.min = Math.min(metric.min, value);
    metric.max = Math.max(metric.max, value);
    metric.lastUpdated = new Date();
  }

  gauge(name: string, value: number): void {
    const metric = this.getOrCreateMetric(name);
    metric.lastValue = value;
    metric.lastUpdated = new Date();
  }

  timing(name: string, durationMs: number): void {
    const metric = this.getOrCreateMetric(name);
    metric.count += 1;
    metric.lastValue = durationMs;
    metric.sum += durationMs;
    metric.min = Math.min(metric.min, durationMs);
    metric.max = Math.max(metric.max, durationMs);
    metric.lastUpdated = new Date();
  }

  getMetric(name: string): Metric | undefined {
    return this.metrics.get(name);
  }

  getAllMetrics(): Record<string, Metric> {
    return Object.fromEntries(this.metrics);
  }

  getUptime(): number {
    return Date.now() - this.startTime.getTime();
  }

  logSummary(): void {
    const uptime = this.getUptime();
    const uptimeHours = (uptime / 3600000).toFixed(2);
    
    logger.info(`Metrics summary (uptime: ${uptimeHours}h)`, {
      metrics: this.getAllMetrics(),
    });
  }

  private getOrCreateMetric(name: string): Metric {
    let metric = this.metrics.get(name);
    if (!metric) {
      metric = {
        count: 0,
        lastValue: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        lastUpdated: new Date(),
      };
      this.metrics.set(name, metric);
    }
    return metric;
  }
}

export const metrics = new MetricsCollector();

// Timer helper
export function startTimer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}

// Track async operation timing
export async function trackTiming<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const timer = startTimer();
  try {
    const result = await fn();
    metrics.timing(name, timer());
    return result;
  } catch (error) {
    metrics.timing(`${name}_error`, timer());
    throw error;
  }
}
