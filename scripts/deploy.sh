#!/bin/bash

# Deploy all services

set -e

echo "Deploying Hyperliquid Tracker..."

# Build all packages
echo "Building packages..."
npm run build

# Deploy database migrations
echo "Deploying database migrations..."
npm run db:migrate

# Deploy Supabase edge functions
echo "Deploying edge functions..."
npx supabase functions deploy update-watchlist
npx supabase functions deploy get-wallet-score
npx supabase functions deploy send-alert

echo ""
echo "Deployment complete!"
echo ""
echo "Note: Frontend (Netlify) and Collector (Render) deploy automatically via Git push"
