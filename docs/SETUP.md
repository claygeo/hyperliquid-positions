# Setup Guide

## Prerequisites

- Node.js 20+
- npm 9+
- Git
- Supabase account (for database)
- Render account (for collector)
- Netlify account (for frontend)

## Local Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/claygeo/hyperliquid-positions.git
cd hyperliquid-tracker
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy the example env files:

```bash
cp .env.example .env
cp apps/collector/.env.example apps/collector/.env
```

Update with your credentials:

```env
# .env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 4. Set Up Database

Run the Supabase migrations:

```bash
npm run db:migrate
```

Or manually apply migrations in Supabase SQL Editor.

### 5. Build Shared Packages

```bash
npm run build --workspace=packages/shared
npm run build --workspace=packages/hyperliquid-sdk
```

### 6. Start Development

Run all services:

```bash
npm run dev
```

Or run individually:

```bash
# Collector
npm run collector:dev

# Web
npm run web:dev
```

## Deployment

### Supabase (Database)

1. Create a new Supabase project
2. Run migrations via CLI or SQL Editor
3. Enable real-time for `positions` and `signals` tables
4. Note your project URL and keys

### Render (Collector)

1. Create a new Background Worker
2. Connect your GitHub repository
3. Configure:
   - Build Command: `npm install && npm run collector:build`
   - Start Command: `npm run collector:start`
4. Add environment variables
5. Deploy

### Netlify (Frontend)

1. Connect your GitHub repository
2. Configure:
   - Base Directory: `apps/web`
   - Build Command: `npm run build`
   - Publish Directory: `.next`
3. Add environment variables
4. Deploy

## Environment Variables Reference

### Collector

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (has full access) |
| `HYPERLIQUID_API_URL` | No | Default: https://api.hyperliquid.xyz |
| `HYPERLIQUID_WS_URL` | No | Default: wss://api.hyperliquid.xyz/ws |
| `LOG_LEVEL` | No | Default: info |
| `TELEGRAM_BOT_TOKEN` | No | For Telegram alerts |
| `TELEGRAM_CHAT_ID` | No | For Telegram alerts |
| `DISCORD_WEBHOOK_URL` | No | For Discord alerts |

### Web

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Anonymous key (for public access) |
