'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/common/loading-spinner';

interface LeaderboardWallet {
  address: string;
  rank: number;
  pnl: number;
  roi: number;
  account_value: number;
  time_window: string;
  last_updated: string;
}

export default function DiscoverPage() {
  const [wallets, setWallets] = useState<LeaderboardWallet[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(function() {
    async function fetchLeaderboard() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('leaderboard_wallets')
        .select('*')
        .order('rank', { ascending: true })
        .limit(100);

      if (!error && data) {
        setWallets(data);
      }
      setIsLoading(false);
    }

    fetchLeaderboard();
    
    const interval = setInterval(fetchLeaderboard, 5 * 60 * 1000);
    return function() {
      clearInterval(interval);
    };
  }, []);

  function formatPnl(pnl: number): string {
    const absValue = Math.abs(pnl);
    const formatted = '$' + absValue.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (pnl >= 0) {
      return '+' + formatted;
    }
    return '-' + formatted;
  }

  function formatRoi(roi: number): string {
    return (roi * 100).toFixed(1) + '%';
  }

  function shortenAddress(addr: string): string {
    return addr.slice(0, 6) + '...' + addr.slice(-4);
  }

  function getPnlClass(pnl: number): string {
    if (pnl >= 0) {
      return 'p-4 text-right font-medium text-green-500';
    }
    return 'p-4 text-right font-medium text-red-500';
  }

  function getRoiClass(roi: number): string {
    if (roi >= 0) {
      return 'p-4 text-right text-green-500';
    }
    return 'p-4 text-right text-red-500';
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Top Traders</h1>
        <p className="text-muted-foreground mt-1">
          Tracking {wallets.length} top performers from Hyperliquid leaderboard
        </p>
      </div>

      <div className="rounded-md border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="h-12 px-4 text-left font-medium">Rank</th>
              <th className="h-12 px-4 text-left font-medium">Wallet</th>
              <th className="h-12 px-4 text-right font-medium">PnL</th>
              <th className="h-12 px-4 text-right font-medium">ROI</th>
              <th className="h-12 px-4 text-right font-medium">Account Value</th>
            </tr>
          </thead>
          <tbody>
            {wallets.map(function(wallet) {
              return (
                <tr key={wallet.address} className="border-b hover:bg-muted/50 transition-colors">
                  <td className="p-4">
                    <Badge variant={wallet.rank <= 10 ? 'default' : 'secondary'}>
                      #{wallet.rank}
                    </Badge>
                  </td>
                  <td className="p-4 font-mono text-sm">
                    <a
                      href={'https://app.hyperliquid.xyz/explorer/address/' + wallet.address}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline text-blue-500"
                    >
                      {shortenAddress(wallet.address)}
                    </a>
                  </td>
                  <td className={getPnlClass(wallet.pnl)}>
                    {formatPnl(wallet.pnl)}
                  </td>
                  <td className={getRoiClass(wallet.roi)}>
                    {formatRoi(wallet.roi)}
                  </td>
                  <td className="p-4 text-right text-muted-foreground">
                    ${wallet.account_value.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {wallets.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No leaderboard data yet. The collector is syncing top traders...
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}