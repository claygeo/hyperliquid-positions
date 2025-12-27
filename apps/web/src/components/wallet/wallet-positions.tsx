import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatNumber } from '@hyperliquid-tracker/shared';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface WalletPositionsProps {
  address: string;
}

async function getPositions(address: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('wallet', address)
    .neq('size', 0)
    .order('margin_used', { ascending: false });

  if (error) {
    console.error('Error fetching positions:', error);
    return [];
  }
  return data || [];
}

export async function WalletPositions({ address }: WalletPositionsProps) {
  const positions = await getPositions(address);

  if (positions.length === 0) {
    return (
      <Card className="p-6 text-center text-muted-foreground">
        No open positions
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {positions.map((position) => {
        const isLong = position.size > 0;
        const pnlPositive = position.unrealized_pnl > 0;

        return (
          <Card key={`${position.wallet}-${position.coin}`} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="font-bold">{position.coin}</span>
                <Badge variant={isLong ? 'success' : 'danger'}>
                  {isLong ? 'Long' : 'Short'}
                </Badge>
              </div>
              <Badge variant="secondary">{position.leverage}x</Badge>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Size</span>
                <span className="font-medium tabular-nums">
                  {formatNumber(Math.abs(position.size), { decimals: 4 })} {position.coin}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted-foreground">Entry Price</span>
                <span className="font-medium tabular-nums">
                  {formatCurrency(position.entry_price)}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted-foreground">Unrealized PnL</span>
                <span className={`font-medium tabular-nums flex items-center gap-1 ${pnlPositive ? 'text-success' : 'text-danger'}`}>
                  {pnlPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {formatCurrency(position.unrealized_pnl)}
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
          </Card>
        );
      })}
    </div>
  );
}
