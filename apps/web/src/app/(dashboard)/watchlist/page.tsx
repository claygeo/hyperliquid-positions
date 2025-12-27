'use client';

import { useWatchlist } from '@/hooks/use-watchlist';
import { WalletCard } from '@/components/wallet/wallet-card';
import { EmptyState } from '@/components/common/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Eye } from 'lucide-react';

export default function WatchlistPage() {
  const { wallets, isLoading } = useWatchlist();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Watchlist</h1>
        <p className="text-muted-foreground mt-1">
          Monitor your tracked wallets in real-time
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : wallets.length === 0 ? (
        <EmptyState
          icon={Eye}
          title="No wallets in watchlist"
          description="Start by adding wallets from the Discover page"
          actionLabel="Discover Wallets"
          actionHref="/discover"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {wallets.map((wallet) => (
            <WalletCard key={wallet.address} wallet={wallet} />
          ))}
        </div>
      )}
    </div>
  );
}
