# Hyperliquid Position Tracker

Track and analyze smart money wallets on Hyperliquid. Find hidden alpha by monitoring wallet behavior, entry timing, and position patterns.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Hyperliquid    │────▶│  Render         │────▶│  Supabase       │
│  WebSocket API  │     │  (collector)    │     │  (postgres)     │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │  Netlify        │
                                                │  (Next.js)      │
                                                └─────────────────┘
```

## Stack

- **Frontend**: Next.js 14 + Tailwind CSS (Netlify)
- **Database**: Supabase (PostgreSQL + Real-time)
- **Collector**: Node.js background worker (Render)
- **Monorepo**: Turborepo + npm workspaces

## Project Structure

```
hyperliquid-tracker/
├── packages/
│   ├── shared/           # Shared types & utilities
│   └── hyperliquid-sdk/  # Typed HL API wrapper
├── apps/
│   ├── collector/        # Background data collector
│   └── web/              # Next.js dashboard
├── supabase/
│   ├── migrations/       # Database schema
│   └── functions/        # Edge functions
└── docs/                 # Documentation
```

## Getting Started

### Prerequisites

- Node.js 20+
- npm 9+
- Supabase CLI (optional, for local dev)

### Installation

```bash
# Clone the repo
git clone https://github.com/claygeo/hyperliquid-positions.git
cd hyperliquid-tracker

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your credentials

# Run database migrations
npm run db:migrate

# Start development
npm run dev
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (collector only) |
| `HYPERLIQUID_API_URL` | Hyperliquid REST API URL |
| `HYPERLIQUID_WS_URL` | Hyperliquid WebSocket URL |

## Features

### Wallet Discovery
- Score wallets by entry timing quality
- Track win rates and risk-adjusted returns
- Identify wallet clusters (same owner)

### Real-time Tracking
- Live position updates via Supabase subscriptions
- WebSocket streaming of all HL trades
- Instant alerts when watched wallets move

### Scoring Metrics
- **Entry Score**: Price movement after entry (-1 to 1)
- **Win Rate**: Percentage of profitable trades
- **Risk-Adjusted Return**: PnL normalized by drawdown
- **Funding Efficiency**: Net funding collected

## Deployment

### Collector (Render)
1. Create a new Background Worker
2. Connect your GitHub repo
3. Set environment variables
4. Deploy

### Frontend (Netlify)
1. Connect your GitHub repo
2. Set build command: `npm run web:build`
3. Set publish directory: `apps/web/.next`
4. Set environment variables
5. Deploy

### Database (Supabase)
1. Create a new project
2. Run migrations: `npm run db:migrate`
3. Enable real-time for required tables

## License

MIT
