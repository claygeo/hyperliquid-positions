// Job scheduler - simple cron-like scheduler

import { createLogger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';

const logger = createLogger('jobs:scheduler');

interface Job {
  name: string;
  fn: () => Promise<void>;
  intervalMs: number;
  lastRun: Date | null;
  isRunning: boolean;
  timer: NodeJS.Timeout | null;
}

class JobScheduler {
  private jobs: Map<string, Job> = new Map();
  private isRunning = false;

  /**
   * Register a job to run at a given interval
   */
  register(
    name: string,
    fn: () => Promise<void>,
    intervalMs: number
  ): void {
    if (this.jobs.has(name)) {
      logger.warn(`Job ${name} already registered, replacing`);
      this.unregister(name);
    }

    this.jobs.set(name, {
      name,
      fn,
      intervalMs,
      lastRun: null,
      isRunning: false,
      timer: null,
    });

    logger.info(`Registered job: ${name} (interval: ${intervalMs}ms)`);
  }

  /**
   * Unregister a job
   */
  unregister(name: string): void {
    const job = this.jobs.get(name);
    if (job) {
      if (job.timer) {
        clearInterval(job.timer);
      }
      this.jobs.delete(name);
      logger.info(`Unregistered job: ${name}`);
    }
  }

  /**
   * Start all registered jobs
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Scheduler already running');
      return;
    }

    this.isRunning = true;
    logger.info(`Starting scheduler with ${this.jobs.size} jobs`);

    for (const [name, job] of this.jobs) {
      this.startJob(job);
    }
  }

  /**
   * Stop all jobs
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    logger.info('Stopping scheduler');

    for (const [, job] of this.jobs) {
      if (job.timer) {
        clearInterval(job.timer);
        job.timer = null;
      }
    }
  }

  /**
   * Run a specific job immediately
   */
  async runNow(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) {
      logger.warn(`Job ${name} not found`);
      return;
    }

    await this.executeJob(job);
  }

  /**
   * Get job status
   */
  getStatus(): Record<string, { lastRun: Date | null; isRunning: boolean }> {
    const status: Record<string, { lastRun: Date | null; isRunning: boolean }> = {};
    
    for (const [name, job] of this.jobs) {
      status[name] = {
        lastRun: job.lastRun,
        isRunning: job.isRunning,
      };
    }

    return status;
  }

  private startJob(job: Job): void {
    // Run immediately on start
    this.executeJob(job);

    // Set up interval
    job.timer = setInterval(() => {
      this.executeJob(job);
    }, job.intervalMs);
  }

  private async executeJob(job: Job): Promise<void> {
    if (job.isRunning) {
      logger.warn(`Job ${job.name} is still running, skipping`);
      return;
    }

    job.isRunning = true;
    const startTime = Date.now();

    try {
      logger.debug(`Starting job: ${job.name}`);
      await job.fn();
      
      const duration = Date.now() - startTime;
      metrics.timing(`job_${job.name}`, duration);
      logger.debug(`Job ${job.name} completed in ${duration}ms`);
    } catch (error) {
      logger.error(`Job ${job.name} failed`, error);
      metrics.increment(`job_${job.name}_errors`);
    } finally {
      job.isRunning = false;
      job.lastRun = new Date();
    }
  }
}

// Singleton instance
export const scheduler = new JobScheduler();

export default scheduler;
