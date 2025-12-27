'use client';

import { Button } from '@/components/ui/button';

const SIGNAL_TYPES = [
  { value: 'new_position', label: 'New Position' },
  { value: 'position_increase', label: 'Increased' },
  { value: 'position_close', label: 'Closed' },
  { value: 'unusual_size', label: 'Unusual Size' },
  { value: 'cluster_convergence', label: 'Cluster' },
  { value: 'high_conviction', label: 'High Conviction' },
];

interface SignalFilters {
  types: string[];
  minConfidence: number;
}

interface SignalFiltersProps {
  filters: SignalFilters;
  onFilterChange: (filters: SignalFilters) => void;
}

export function SignalFilters({ filters, onFilterChange }: SignalFiltersProps) {
  const toggleType = (type: string) => {
    const newTypes = filters.types.includes(type)
      ? filters.types.filter((t) => t !== type)
      : [...filters.types, type];
    onFilterChange({ ...filters, types: newTypes });
  };

  const clearFilters = () => {
    onFilterChange({ types: [], minConfidence: 0 });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {SIGNAL_TYPES.map((signalType) => (
        <Button
          key={signalType.value}
          variant={filters.types.includes(signalType.value) ? 'default' : 'outline'}
          size="sm"
          onClick={() => toggleType(signalType.value)}
        >
          {signalType.label}
        </Button>
      ))}

      {filters.types.length > 0 && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear
        </Button>
      )}
    </div>
  );
}