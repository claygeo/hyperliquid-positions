# API Documentation

## Hyperliquid API

The collector service interfaces with Hyperliquid's public API.

### REST Endpoints

Base URL: `https://api.hyperliquid.xyz`

#### Info Endpoint (POST /info)

All read operations use the `/info` endpoint with different request bodies.

##### Get All Mid Prices
```json
{ "type": "allMids" }
```

##### Get User State
```json
{ "type": "clearinghouseState", "user": "0x..." }
```

##### Get User Fills
```json
{ "type": "userFills", "user": "0x..." }
```

##### Get User Fills by Time
```json
{ "type": "userFillsByTime", "user": "0x...", "startTime": 1234567890000 }
```

##### Get Ledger Updates (Transfers)
```json
{ "type": "userNonFundingLedgerUpdates", "user": "0x..." }
```

### WebSocket

URL: `wss://api.hyperliquid.xyz/ws`

#### Subscribe to Trades
```json
{
  "method": "subscribe",
  "subscription": { "type": "trades", "coin": "BTC" }
}
```

#### Subscribe to User Fills
```json
{
  "method": "subscribe",
  "subscription": { "type": "userFills", "user": "0x..." }
}
```

#### Subscribe to All Mids
```json
{
  "method": "subscribe",
  "subscription": { "type": "allMids" }
}
```

## Supabase Tables

### wallets
| Column | Type | Description |
|--------|------|-------------|
| address | text | Wallet address (PK) |
| first_seen | timestamptz | First trade timestamp |
| total_trades | int | Total trade count |
| total_volume | numeric | Total trading volume |
| win_rate | numeric | Win rate (0-1) |
| entry_score | numeric | Entry quality score (-1 to 1) |
| overall_score | numeric | Overall wallet score (0-1) |
| is_active | boolean | Whether wallet is actively tracked |

### trades
| Column | Type | Description |
|--------|------|-------------|
| id | serial | Trade ID (PK) |
| wallet | text | Wallet address (FK) |
| coin | text | Trading pair |
| side | text | 'B' for buy, 'A' for sell |
| size | numeric | Trade size |
| price | numeric | Execution price |
| timestamp | timestamptz | Trade timestamp |
| closed_pnl | numeric | Closed PnL if position closed |
| entry_score | numeric | Entry quality score |

### positions
| Column | Type | Description |
|--------|------|-------------|
| id | serial | Position ID (PK) |
| wallet | text | Wallet address |
| coin | text | Trading pair |
| size | numeric | Position size (negative = short) |
| entry_price | numeric | Average entry price |
| leverage | int | Leverage multiplier |
| unrealized_pnl | numeric | Current unrealized PnL |

### signals
| Column | Type | Description |
|--------|------|-------------|
| id | serial | Signal ID (PK) |
| signal_type | text | Type of signal |
| wallets | text[] | Related wallet addresses |
| coin | text | Related coin (optional) |
| direction | text | 'long' or 'short' |
| confidence | numeric | Signal confidence (0-1) |
| created_at | timestamptz | Signal creation time |

## Edge Functions

### update-watchlist
Add or remove wallets from watchlist.

```bash
POST /functions/v1/update-watchlist
{
  "action": "add" | "remove",
  "wallet_address": "0x...",
  "user_id": "user-uuid"
}
```

### get-wallet-score
Get detailed wallet score breakdown.

```bash
GET /functions/v1/get-wallet-score?address=0x...
```

### send-alert
Send notifications via Telegram or Discord.

```bash
POST /functions/v1/send-alert
{
  "type": "telegram" | "discord",
  "message": "Alert message",
  "chatId": "...",
  "webhookUrl": "..."
}
```
