# Scoring Algorithm

## Overview

The wallet scoring system evaluates traders based on multiple metrics to identify consistently profitable wallets worth following.

## Score Components

### 1. Entry Quality Score (35% weight)

Measures how well a trader times their entries.

**Calculation:**
- Track price at entry time
- Compare to price 5 minutes, 1 hour, and 4 hours later
- For longs: positive price movement = good entry
- For shorts: negative price movement = good entry

**Formula:**
```
entry_score = weighted_average(
  score_5m * 0.2,
  score_1h * 0.4,
  score_4h * 0.4
)

where score = (price_later - entry_price) / entry_price * direction
direction = 1 for longs, -1 for shorts
```

**Range:** -1 to 1 (normalized)

### 2. Win Rate (25% weight)

Percentage of trades that close profitably.

**Calculation:**
```
win_rate = profitable_trades / total_closed_trades
```

**Normalization:**
- Below 40% → 0
- Above 70% → 1
- Linear interpolation between

### 3. Risk-Adjusted Return (20% weight)

Similar to Sharpe ratio, measures return per unit of risk.

**Calculation:**
```
risk_adjusted = mean(pnl) / std_dev(pnl)
```

**Range:** Normalized to -1 to 1

### 4. Consistency (10% weight)

How steady are returns over time.

**Calculation:**
- Divide trades into periods
- Count positive periods / total periods
- Penalize for long losing streaks

### 5. Funding Efficiency (10% weight)

Ability to collect positive funding.

**Calculation:**
```
funding_efficiency = total_funding / total_position_hours
```

## Overall Score

```
overall_score = 
  entry_quality * 0.35 +
  normalized_win_rate * 0.25 +
  risk_adjusted * 0.20 +
  consistency * 0.10 +
  funding_efficiency * 0.10
```

## Confidence Level

Based on sample size:
- < 20 trades: No score calculated
- 20-50 trades: Low confidence (0-0.5)
- 50-100 trades: Medium confidence (0.5-0.8)
- > 100 trades: High confidence (0.8-1.0)

## Score Tiers

| Score | Tier | Color |
|-------|------|-------|
| 80-100 | Exceptional | Green |
| 60-79 | Good | Lime |
| 40-59 | Average | Yellow |
| 20-39 | Poor | Orange |
| 0-19 | Bad | Red |

## Signal Thresholds

- Minimum wallet score for signals: 60
- Unusual size multiplier: 3x average
- Cluster agreement threshold: 70%

## Updating Scores

Scores are recalculated:
- Every 5 minutes for active wallets
- On every 10 new trades for a wallet
- Nightly for all wallets

## Filtering Bots

Wallets are flagged as potential bots if:
- Very regular trade intervals (low variance)
- Identical trade sizes (> 90% same)
- 24/7 activity (trades in 20+ hours)

Bot-flagged wallets are excluded from leaderboards but still tracked.
