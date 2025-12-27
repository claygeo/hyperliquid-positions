import { cn } from '@/lib/utils/cn';

interface CoinIconProps {
  coin: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-5 h-5 text-xs',
  md: 'w-6 h-6 text-sm',
  lg: 'w-8 h-8 text-base',
};

// Map coins to their brand colors
const coinColors: Record<string, string> = {
  BTC: 'bg-orange-500',
  ETH: 'bg-blue-500',
  SOL: 'bg-purple-500',
  DOGE: 'bg-yellow-500',
  XRP: 'bg-gray-500',
  ADA: 'bg-blue-400',
  AVAX: 'bg-red-500',
  LINK: 'bg-blue-600',
  DOT: 'bg-pink-500',
  MATIC: 'bg-purple-600',
  UNI: 'bg-pink-400',
  ATOM: 'bg-purple-400',
  ARB: 'bg-blue-500',
  OP: 'bg-red-600',
  INJ: 'bg-blue-400',
  SUI: 'bg-blue-300',
  SEI: 'bg-red-400',
  PEPE: 'bg-green-500',
  SHIB: 'bg-orange-400',
  WIF: 'bg-amber-500',
};

export function CoinIcon({ coin, size = 'md', className }: CoinIconProps) {
  const bgColor = coinColors[coin] || 'bg-muted';
  
  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-bold text-white',
        sizeClasses[size],
        bgColor,
        className
      )}
    >
      {coin.slice(0, 1)}
    </div>
  );
}

export function CoinBadge({ coin, className }: { coin: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <CoinIcon coin={coin} size="sm" />
      <span className="font-medium">{coin}</span>
    </div>
  );
}
