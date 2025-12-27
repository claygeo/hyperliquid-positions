import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatNumber, timeAgo } from '@hyperliquid-tracker/shared';

interface WalletTradesProps {
  address: string;
}

async function getTrades(address: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('wallet', address)
    .order('timestamp', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error fetching trades:', error);
    return [];
  }
  return data || [];
}

export async function WalletTrades({ address }: WalletTradesProps) {
  const trades = await getTrades(address);

  if (trades.length === 0) {
    return (
      <Card className="p-6 text-center text-muted-foreground">
        No recent trades
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Coin</TableHead>
            <TableHead>Side</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>PnL</TableHead>
            <TableHead>Entry Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((trade) => {
            const isBuy = trade.side === 'B';
            const hasPnl = trade.closed_pnl !== null;
            const pnlPositive = trade.closed_pnl > 0;

            return (
              <TableRow key={trade.id}>
                <TableCell className="text-muted-foreground">
                  {timeAgo(new Date(trade.timestamp))}
                </TableCell>
                <TableCell className="font-medium">{trade.coin}</TableCell>
                <TableCell>
                  <Badge variant={isBuy ? 'success' : 'danger'}>
                    {isBuy ? 'Buy' : 'Sell'}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatNumber(trade.size, { decimals: 4 })}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatCurrency(trade.price)}
                </TableCell>
                <TableCell>
                  {hasPnl ? (
                    <span className={pnlPositive ? 'text-success' : 'text-danger'}>
                      {formatCurrency(trade.closed_pnl)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  {trade.entry_score !== null ? (
                    <Badge 
                      variant={trade.entry_score > 0 ? 'success' : trade.entry_score < 0 ? 'danger' : 'secondary'}
                    >
                      {(trade.entry_score * 100).toFixed(1)}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
