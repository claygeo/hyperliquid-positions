'use client';

import { useSignals } from '@/hooks/use-signals';
import { SignalFeed } from '@/components/signal/signal-feed';
import { SignalFilters } from '@/components/signal/signal-filters';
import { Skeleton } from '@/components/ui/skeleton';

export default function SignalsPage() {
  const { signals, isLoading, filters, setFilters } = useSignals();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Signals</h1>
        <p className="text-muted-foreground mt-1">
          Real-time alerts when tracked wallets make moves
        </p>
      </div>

      <SignalFilters filters={filters} onChange={setFilters} />

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <SignalFeed signals={signals} />
      )}
    </div>
  );
}
