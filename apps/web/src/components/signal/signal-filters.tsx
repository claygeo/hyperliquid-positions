'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface SignalFilters {
  types: string[];
  minConfidence: number;
}

interface SignalFiltersProps {
  filters: SignalFilters;
  onChange: (filters: SignalFilters) => void;
}

const signalTypes = [
  { value: 'new_position', label: 'New Position' },
  { value: 'position_increase', label: 'Increase' },
  { value: 'position_close', label: 'Close' },
  { value: 'cluster_convergence', label: 'Cluster' },
  { value: 'unusual_size', label: 'Unusual Size' },
];

export function SignalFilters({ filters, onChange }: SignalFiltersProps) {
  const toggleType = (type: string) => {
    const newTypes = filters.types.includes(type)
      ? filters.types.filter((t) => t !== type)
      : [...filters.types, type];
    onChange({ ...filters, types: newTypes });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground mr-2">Filter:</span>
      {signalTypes.map((type) => (
        <Button
          key={type.value}
          variant={filters.types.includes(type.value) ? 'default' : 'outline'}
          size="sm"
          onClick={() => toggleType(type.value)}
        >
          {type.label}
        </Button>
      ))}
      {filters.types.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...filters, types: [] })}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
