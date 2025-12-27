import { Card } from '@/components/ui/card';
import { formatCurrency, formatNumber, formatPercent } from '@hyperliquid-tracker/shared';
import { TrendingUp, TrendingDown, Target, Clock, DollarSign, BarChart3 } from 'lucide-react';

interface Wallet {
  total_trades: number;
  total_volume: number;
  win_rate: number | null;
  entry_score: number | null;
  risk_adjusted_return: number | null;
  avg_hold_minutes: number | null;
  funding_efficiency: number | null;
  overall_score: number | null;
}

interface WalletStatsProps {
  wallet: Wallet;
}

export function WalletStats({ wallet }: WalletStatsProps) {
  const stats = [
    {
      label: 'Win Rate',
      value: wallet.win_rate !== null ? formatPercent(wallet.win_rate) : '-',
      icon: wallet.win_rate !== null && wallet.win_rate >= 0.5 ? TrendingUp : TrendingDown,
      color: wallet.win_rate !== null && wallet.win_rate >= 0.5 ? 'text-success' : 'text-danger',
    },
    {
      label: 'Entry Score',
      value: wallet.entry_score !== null ? (wallet.entry_score * 100).toFixed(1) : '-',
      icon: Target,
      color: wallet.entry_score !== null && wallet.entry_score > 0 ? 'text-success' : 'text-danger',
    },
    {
      label: 'Total Volume',
      value: formatCurrency(wallet.total_volume, { compact: true }),
      icon: DollarSign,
      color: 'text-primary',
    },
    {
      label: 'Total Trades',
      value: formatNumber(wallet.total_trades),
      icon: BarChart3,
      color: 'text-primary',
    },
    {
      label: 'Avg Hold Time',
      value: wallet.avg_hold_minutes !== null 
        ? wallet.avg_hold_minutes < 60 
          ? `${Math.round(wallet.avg_hold_minutes)}m`
          : `${Math.round(wallet.avg_hold_minutes / 60)}h`
        : '-',
      icon: Clock,
      color: 'text-muted-foreground',
    },
    {
      label: 'Risk Adjusted',
      value: wallet.risk_adjusted_return !== null 
        ? (wallet.risk_adjusted_return * 100).toFixed(1) 
        : '-',
      icon: TrendingUp,
      color: wallet.risk_adjusted_return !== null && wallet.risk_adjusted_return > 0 
        ? 'text-success' 
        : 'text-danger',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <stat.icon className={`h-4 w-4 ${stat.color}`} />
            <span className="text-sm text-muted-foreground">{stat.label}</span>
          </div>
          <p className="text-2xl font-bold tabular-nums">{stat.value}</p>
        </Card>
      ))}
    </div>
  );
}
