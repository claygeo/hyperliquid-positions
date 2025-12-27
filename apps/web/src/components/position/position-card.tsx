import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CoinIcon } from '@/components/common/coin-icon';
import { formatCurrency, formatNumber } from '@hyperliquid-tracker/shared';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface Position {
  coin: string;
  size: number;
  entry_price: number;
  leverage: number;
  leverage_type: 'cross' | 'isolated';
  unrealized_pnl: number;
  liquidation_price: number | null;
  margin_used: number;
}

interface PositionCardProps {
  position: Position;
  className?: string;
}

export function PositionCard({ position, className }: PositionCardProps) {
  const isLong = position.size > 0;
  const pnlPositive = position.unrealized_pnl > 0;
  const roe = (position.unrealized_pnl / position.margin_used) * 100;

  return (
    <Card className={className}>
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CoinIcon coin={position.coin} />
            <span className="font-bold">{position.coin}</span>
            <Badge variant={isLong ? 'success' : 'danger'}>
              {isLong ? 'Long' : 'Short'}
            </Badge>
          </div>
          <Badge variant="secondary">
            {position.leverage}x {position.leverage_type}
          </Badge>
        </div>

        {/* Stats */}
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Size</span>
            <span className="font-medium tabular-nums">
              {formatNumber(Math.abs(position.size), { decimals: 4 })} {position.coin}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-muted-foreground">Entry</span>
            <span className="font-medium tabular-nums">
              {formatCurrency(position.entry_price)}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-muted-foreground">Unrealized PnL</span>
            <span
              className={`font-medium tabular-nums flex items-center gap-1 ${
                pnlPositive ? 'text-success' : 'text-danger'
              }`}
            >
              {pnlPositive ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {formatCurrency(position.unrealized_pnl)} ({roe.toFixed(1)}%)
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-muted-foreground">Margin</span>
            <span className="font-medium tabular-nums">
              {formatCurrency(position.margin_used)}
            </span>
          </div>

          {position.liquidation_price && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Liq. Price</span>
              <span className="font-medium tabular-nums text-warning">
                {formatCurrency(position.liquidation_price)}
              </span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
