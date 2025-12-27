import { SignalCard } from './signal-card';
import { EmptyState } from '@/components/common/empty-state';
import { Bell } from 'lucide-react';

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

interface SignalFeedProps {
  signals: Signal[];
}

export function SignalFeed({ signals }: SignalFeedProps) {
  if (signals.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="No signals yet"
        description="Signals will appear here when high-scoring wallets make moves"
      />
    );
  }

  return (
    <div className="space-y-4">
      {signals.map((signal) => (
        <SignalCard key={signal.id} signal={signal} />
      ))}
    </div>
  );
}