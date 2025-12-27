// Signal and alert types

import type { SignalType } from './database';

export interface Signal {
  id: number;
  type: SignalType;
  wallets: string[];
  coin: string | null;
  direction: 'long' | 'short' | null;
  confidence: number;
  metadata: SignalMetadata;
  createdAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
}

export interface SignalMetadata {
  // Position signals
  positionSize?: number;
  entryPrice?: number;
  leverage?: number;
  
  // Cluster signals
  clusterSize?: number;
  clusterConfidence?: number;
  
  // Score signals
  walletScore?: number;
  entryScore?: number;
  
  // Price context
  currentPrice?: number;
  priceChange24h?: number;
  
  // Additional context
  message?: string;
  [key: string]: unknown;
}

export interface SignalFilter {
  types?: SignalType[];
  coins?: string[];
  minConfidence?: number;
  wallets?: string[];
  direction?: 'long' | 'short';
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface AlertConfig {
  enabled: boolean;
  minScore: number;
  signalTypes: SignalType[];
  coins: string[] | null; // null = all coins
  telegram?: {
    chatId: string;
    botToken: string;
  };
  discord?: {
    webhookUrl: string;
  };
}

export interface AlertPayload {
  signal: Signal;
  walletScores: Record<string, number>;
  message: string;
  timestamp: Date;
}

// Real-time signal event
export interface SignalEvent {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  signal: Signal;
  timestamp: Date;
}

// Signal creation params
export interface CreateSignalParams {
  type: SignalType;
  wallets: string[];
  coin?: string;
  direction?: 'long' | 'short';
  confidence: number;
  metadata?: SignalMetadata;
  expiresInMinutes?: number;
}
