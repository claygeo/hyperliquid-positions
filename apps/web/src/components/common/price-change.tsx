import { cn } from '@/lib/utils/cn';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface PriceChangeProps {
  value: number;
  isPercent?: boolean;
  showIcon?: boolean;
  className?: string;
}

export function PriceChange({ 
  value, 
  isPercent = false, 
  showIcon = true,
  className 
}: PriceChangeProps) {
  const isPositive = value >= 0;
  const displayValue = isPercent 
    ? `${(value * 100).toFixed(1)}%`
    : value.toFixed(2);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium tabular-nums',
        isPositive ? 'text-success' : 'text-danger',
        className
      )}
    >
      {showIcon && (
        isPositive ? (
          <TrendingUp className="h-3 w-3" />
        ) : (
          <TrendingDown className="h-3 w-3" />
        )
      )}
      {isPositive && !isPercent && '+'}
      {displayValue}
    </span>
  );
}
