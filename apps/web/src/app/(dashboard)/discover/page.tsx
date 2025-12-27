import { Suspense } from 'react';
import { WalletTable } from '@/components/wallet/wallet-table';
import { WalletTableSkeleton } from '@/components/wallet/wallet-table-skeleton';

export default function DiscoverPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Discover Wallets</h1>
        <p className="text-muted-foreground mt-1">
          Find high-performing wallets based on entry timing and win rate
        </p>
      </div>

      <Suspense fallback={<WalletTableSkeleton />}>
        <WalletTable />
      </Suspense>
    </div>
  );
}
