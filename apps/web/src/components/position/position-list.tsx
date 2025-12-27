import { PositionCard } from './position-card';
import { EmptyState } from '@/components/common/empty-state';
import { LayoutGrid } from 'lucide-react';

interface Position {
  id: number;
  wallet: string;
  coin: string;
  size: number;
  entry_price: number;
  leverage: number;
  leverage_type: 'cross' | 'isolated';
  unrealized_pnl: number;
  liquidation_price: number | null;
  margin_used: number;
}

interface PositionListProps {
  positions: Position[];
  layout?: 'grid' | 'list';
}

export function PositionList({ positions, layout = 'grid' }: PositionListProps) {
  if (positions.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title="No open positions"
        description="This wallet has no active positions"
      />
    );
  }

  if (layout === 'list') {
    return (
      <div className="space-y-3">
        {positions.map((position) => (
          <PositionCard
            key={`${position.wallet}-${position.coin}`}
            position={position}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {positions.map((position) => (
        <PositionCard
          key={`${position.wallet}-${position.coin}`}
          position={position}
        />
      ))}
    </div>
  );
}
