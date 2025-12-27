FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/hyperliquid-sdk/package*.json ./packages/hyperliquid-sdk/
COPY apps/collector/package*.json ./apps/collector/

# Install dependencies
RUN npm install

# Copy source files
COPY packages/shared ./packages/shared
COPY packages/hyperliquid-sdk ./packages/hyperliquid-sdk
COPY apps/collector ./apps/collector

# Build packages
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/hyperliquid-sdk
RUN npm run build --workspace=apps/collector

# Set working directory to collector
WORKDIR /app/apps/collector

# Start the collector
CMD ["npm", "run", "start"]
