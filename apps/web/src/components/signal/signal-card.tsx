import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AddressDisplay } from '@/components/common/address-display';
import { TimeAgo } from '@/components/common/time-ago';
import { CoinIcon } from '@/components/common/coin-icon';
import {
  TrendingUp,
  TrendingDown,
  Users,
  AlertTriangle,
  Zap,
} from 'lucide-react';

interface Signal {
  id: number;
  signal_type: string;
  wallets: string[];
  coin: string | null;
  direction: 'long' | 'short' | null;
  confidence: number;
  metadata: Record<string, unknown>;
  created_at: string;
  is_active: boolean;
}

interface SignalCardProps {
  signal: Signal;
}

const signalConfig: Record<string, { icon: typeof TrendingUp; color: string; label: string }> = {
  new_position: {
    icon: TrendingUp,
    color: 'text-success',
    label: 'New Position',
  },
  position_increase: {
    icon: TrendingUp,
    color: 'text-success',
    label: 'Position Increased',
  },
  position_close: {
    icon: TrendingDown,
    color: 'text-warning',
    label: 'Position Closed',
  },
  unusual_size: {
    icon: AlertTriangle,
    color: 'text-warning',
    label: 'Unusual Size',
  },
  cluster_convergence: {
    icon: Users,
    color: 'text-primary',
    label: 'Cluster Activity',
  },
  high_conviction: {
    icon: Zap,
    color: 'text-primary',
    label: 'High Conviction',
  },
};

export function SignalCard({ signal }: SignalCardProps) {
  const config = signalConfig[signal.signal_type] || {
    icon: Zap,
    color: 'text-muted-foreground',
    label: signal.signal_type,
  };

  const Icon = config.icon;
  const walletScore = signal.metadata?.walletScore as number | undefined;
  const size = signal.metadata?.size as number | undefined;

  return (
    <Card className="p-4 hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg bg-muted ${config.color}`}>
            <Icon className="h-5 w-5" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{config.label}</span>
              {signal.coin && <CoinIcon coin={signal.coin} size="sm" />}
              {signal.direction && (
                <Badge variant={signal.direction === 'long' ? 'success' : 'danger'}>
                  {signal.direction.toUpperCase()}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {signal.wallets.slice(0, 2).map((wallet) => (
                <Link key={wallet} href={`/wallet/${wallet}`}>
                  <AddressDisplay address={wallet} />
                </Link>
              ))}
              {signal.wallets.length > 2 && (
                <span>+{signal.wallets.length - 2} more</span>
              )}
            </div>
          </div>
        </div>

        <div className="text-right text-sm">
          <div className="text-muted-foreground">
            <TimeAgo date={signal.created_at} />
          </div>
          <div>
            <span className="text-muted-foreground">Confidence: </span>
            <span className="font-medium">{(signal.confidence * 100).toFixed(0)}%</span>
          </div>
          {walletScore !== undefined && (
            <div>
              <span className="text-muted-foreground">Wallet Score: </span>
              <span className="font-medium">{(walletScore * 100).toFixed(0)}</span>
            </div>
          )}
          {size !== undefined && (
            <div>
              <span className="text-muted-foreground">Size: </span>
              <span className="font-medium">${size.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}