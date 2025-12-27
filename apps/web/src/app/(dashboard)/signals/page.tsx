'use client';

import { useSignals } from '@/hooks/use-signals';
import { SignalFeed } from '@/components/signal/signal-feed';
import { SignalFilters } from '@/components/signal/signal-filters';
import { LoadingSpinner } from '@/components/common/loading-spinner';

export default function SignalsPage() {
  const { signals, isLoading, filter, setFilter } = useSignals();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Signals</h1>
        <p className="text-muted-foreground">
          Real-time trading signals from high-scoring wallets
        </p>
      </div>

      <SignalFilters filter={filter} onFilterChange={setFilter} />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <SignalFeed signals={signals.map(s => ({ ...s, is_active: true }))} />
      )}
    </div>
  );
}