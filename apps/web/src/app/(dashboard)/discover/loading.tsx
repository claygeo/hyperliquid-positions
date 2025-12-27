import { WalletTableSkeleton } from '@/components/wallet/wallet-table-skeleton';

export default function Loading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-9 w-48 bg-muted rounded animate-pulse" />
        <div className="h-5 w-96 bg-muted rounded animate-pulse mt-2" />
      </div>
      <WalletTableSkeleton />
    </div>
  );
}
