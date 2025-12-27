import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AddressDisplay } from '@/components/common/address-display';
import { TimeAgo } from '@/components/common/time-ago';
import { TrendingUp, TrendingDown, AlertCircle, Users } from 'lucide-react';

interface Signal {
  id: number;
  signal_type: string;
  wallets: string[];
  coin: string | null;
  direction: 'long' | 'short' | null;
  confidence: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface SignalCardProps {
  signal: Signal;
}

const signalTypeConfig: Record<string, { label: string; icon: typeof TrendingUp; color: string }> = {
  new_position: { label: 'New Position', icon: TrendingUp, color: 'text-primary' },
  position_increase: { label: 'Position Increase', icon: TrendingUp, color: 'text-success' },
  position_close: { label: 'Position Closed', icon: TrendingDown, color: 'text-warning' },
  cluster_convergence: { label: 'Cluster Signal', icon: Users, color: 'text-primary' },
  unusual_size: { label: 'Unusual Size', icon: AlertCircle, color: 'text-warning' },
  high_score_entry: { label: 'High Score Entry', icon: TrendingUp, color: 'text-success' },
};

export function SignalCard({ signal }: SignalCardProps) {
  const config = signalTypeConfig[signal.signal_type] || {
    label: signal.signal_type,
    icon: AlertCircle,
    color: 'text-muted-foreground',
  };
  const Icon = config.icon;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${config.color}`} />
          <span className="font-semibold">{config.label}</span>
          {signal.coin && (
            <Badge variant="secondary">{signal.coin}</Badge>
          )}
          {signal.direction && (
            <Badge variant={signal.direction === 'long' ? 'success' : 'danger'}>
              {signal.direction.toUpperCase()}
            </Badge>
          )}
        </div>
        <TimeAgo date={signal.created_at} />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">Wallets:</span>
        {signal.wallets.slice(0, 3).map((wallet) => (
          <Link key={wallet} href={`/wallet/${wallet}`}>
            <AddressDisplay address={wallet} className="text-xs hover:text-primary" />
          </Link>
        ))}
        {signal.wallets.length > 3 && (
          <span className="text-sm text-muted-foreground">
            +{signal.wallets.length - 3} more
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">Confidence: </span>
          <span className="font-medium">{(signal.confidence * 100).toFixed(0)}%</span>
        </div>
        {signal.metadata.walletScore && (
          <div>
            <span className="text-muted-foreground">Wallet Score: </span>
            <span className="font-medium">{((signal.metadata.walletScore as number) * 100).toFixed(0)}</span>
          </div>
        )}
        {signal.metadata.notional && (
          <div>
            <span className="text-muted-foreground">Size: </span>
            <span className="font-medium">${(signal.metadata.notional as number).toLocaleString()}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
