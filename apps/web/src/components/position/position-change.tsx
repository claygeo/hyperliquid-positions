'use client';

import { cn } from '@/lib/utils/cn';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

type ChangeType = 'increase' | 'decrease' | 'new' | 'closed' | 'none';

interface PositionChangeProps {
  type: ChangeType;
  value?: number;
  className?: string;
}

export function PositionChange({ type, value, className }: PositionChangeProps) {
  const config: Record<ChangeType, { icon: typeof TrendingUp; color: string; label: string }> = {
    increase: {
      icon: TrendingUp,
      color: 'text-success bg-success/10',
      label: 'Increased',
    },
    decrease: {
      icon: TrendingDown,
      color: 'text-warning bg-warning/10',
      label: 'Decreased',
    },
    new: {
      icon: TrendingUp,
      color: 'text-primary bg-primary/10',
      label: 'New',
    },
    closed: {
      icon: Minus,
      color: 'text-muted-foreground bg-muted',
      label: 'Closed',
    },
    none: {
      icon: Minus,
      color: 'text-muted-foreground',
      label: '',
    },
  };

  const { icon: Icon, color, label } = config[type];

  if (type === 'none') {
    return null;
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        color,
        className
      )}
    >
      <Icon className="h-3 w-3" />
      <span>{label}</span>
      {value !== undefined && (
        <span className="tabular-nums">
          {value > 0 ? '+' : ''}{value.toFixed(2)}%
        </span>
      )}
    </div>
  );
}

// Animated dot for real-time updates
export function LiveIndicator({ active = true }: { active?: boolean }) {
  if (!active) return null;

  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
    </span>
  );
}
