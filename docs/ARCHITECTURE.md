# Architecture

## Overview

Hyperliquid Tracker is a monorepo application for tracking and analyzing smart money wallets on Hyperliquid DEX.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Data Sources                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Hyperliquid     │  │ Hyperliquid     │  │ Historical      │ │
│  │ WebSocket API   │  │ REST API        │  │ S3 Data         │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘ │
└───────────┼─────────────────────┼─────────────────────┼─────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Collector Service (Render)                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Trade Stream    │  │ Position Poller │  │ Scheduled Jobs  │ │
│  │ Collector       │  │                 │  │                 │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘ │
│           │                    │                    │           │
│           ▼                    ▼                    ▼           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Processors                            │   │
│  │  Trade Processor │ Wallet Scorer │ Entry Analyzer       │   │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Supabase (PostgreSQL)                       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │ Wallets │ │ Trades  │ │Positions│ │ Signals │ │Clusters │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
│                    Real-time Subscriptions                       │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Frontend (Netlify)                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Discover Page   │  │ Watchlist Page  │  │ Signals Page    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Package Structure

### packages/shared
Shared TypeScript types and utilities used across the monorepo.
- Types for Hyperliquid API responses
- Database table types
- Scoring constants and calculations
- Formatting utilities

### packages/hyperliquid-sdk
Typed SDK for interacting with Hyperliquid API.
- REST client for info endpoints
- WebSocket connection manager with auto-reconnect
- Position and trade parsing utilities

### apps/collector
Background worker service that:
- Streams all trades via WebSocket
- Polls positions for tracked wallets
- Calculates wallet scores
- Generates trading signals
- Backfills price data for entry scoring

### apps/web
Next.js 14 frontend with:
- Wallet discovery and ranking
- Real-time watchlist tracking
- Signal feed
- Individual wallet analysis

## Data Flow

1. **Trade Collection**: All trades streamed via WebSocket
2. **Wallet Discovery**: New wallets identified from trade participants
3. **Position Tracking**: Periodic polling of clearinghouse state
4. **Score Calculation**: Batch job calculates wallet metrics
5. **Signal Generation**: Real-time signals from high-score wallet activity
6. **Frontend Display**: Real-time updates via Supabase subscriptions

## Scoring Algorithm

See [SCORING.md](./SCORING.md) for details on how wallet scores are calculated.
