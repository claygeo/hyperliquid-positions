#!/bin/bash

# Local development setup script

set -e

echo "Setting up local development environment..."

# Check for required tools
command -v node >/dev/null 2>&1 || { echo "Node.js is required but not installed."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required but not installed."; exit 1; }

# Install dependencies
echo "Installing dependencies..."
npm install

# Build shared packages
echo "Building shared packages..."
npm run build --workspace=packages/shared
npm run build --workspace=packages/hyperliquid-sdk

# Copy environment files if they don't exist
if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
  echo "Please update .env with your credentials"
fi

if [ ! -f apps/collector/.env ]; then
  cp apps/collector/.env.example apps/collector/.env
fi

if [ ! -f apps/web/.env.local ]; then
  echo "NEXT_PUBLIC_SUPABASE_URL=https://cjdrgvbrziahiakxhxsy.supabase.co" > apps/web/.env.local
  echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key" >> apps/web/.env.local
fi

echo ""
echo "Setup complete! Next steps:"
echo "1. Update .env files with your credentials"
echo "2. Run 'npm run db:migrate' to set up the database"
echo "3. Run 'npm run dev' to start development servers"
