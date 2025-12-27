import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AddressDisplay } from '@/components/common/address-display';
import { WalletScore } from './wallet-score';
import { TimeAgo } from '@/components/common/time-ago';
import { formatCurrency, formatNumber } from '@hyperliquid-tracker/shared';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface Wallet {
  address: string;
  total_trades: number;
  total_volume: number;
  win_rate: number | null;
  entry_score: number | null;
  overall_score: number | null;
  last_trade_at: string | null;
}

interface WalletCardProps {
  wallet: Wallet;
}

export function WalletCard({ wallet }: WalletCardProps) {
  const winRate = wallet.win_rate !== null ? (wallet.win_rate * 100).toFixed(1) : null;
  const isPositiveEntry = wallet.entry_score !== null && wallet.entry_score > 0;

  return (
    <Link href={`/wallet/${wallet.address}`}>
      <Card className="p-4 hover:bg-muted/50 transition-colors cursor-pointer">
        <div className="flex items-start justify-between mb-3">
          <AddressDisplay address={wallet.address} />
          <WalletScore score={wallet.overall_score} />
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground">Win Rate</p>
            <p className="font-medium flex items-center gap-1">
              {winRate !== null ? (
                <>
                  {parseFloat(winRate) >= 50 ? (
                    <TrendingUp className="h-3 w-3 text-success" />
                  ) : (
                    <TrendingDown className="h-3 w-3 text-danger" />
                  )}
                  {winRate}%
                </>
              ) : (
                '-'
              )}
            </p>
          </div>

          <div>
            <p className="text-muted-foreground">Entry Score</p>
            <p className="font-medium">
              {wallet.entry_score !== null ? (
                <Badge 
                  variant={isPositiveEntry ? 'success' : 'danger'}
                  className="text-xs"
                >
                  {(wallet.entry_score * 100).toFixed(1)}
                </Badge>
              ) : (
                '-'
              )}
            </p>
          </div>

          <div>
            <p className="text-muted-foreground">Volume</p>
            <p className="font-medium tabular-nums">
              {formatCurrency(wallet.total_volume, { compact: true })}
            </p>
          </div>

          <div>
            <p className="text-muted-foreground">Trades</p>
            <p className="font-medium tabular-nums">
              {formatNumber(wallet.total_trades)}
            </p>
          </div>
        </div>

        {wallet.last_trade_at && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Last trade <TimeAgo date={wallet.last_trade_at} />
            </p>
          </div>
        )}
      </Card>
    </Link>
  );
}
