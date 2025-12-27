import { cn } from '@/lib/utils/cn';
import { getScoreTier, SCORE_TIERS } from '@hyperliquid-tracker/shared';

interface WalletScoreProps {
  score: number | null;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export function WalletScore({ score, size = 'md', showLabel = false }: WalletScoreProps) {
  if (score === null) {
    return <span className="text-muted-foreground">-</span>;
  }

  const tier = getScoreTier(score);
  const tierInfo = SCORE_TIERS[tier];
  const displayScore = Math.round(score * 100);

  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-0.5',
    lg: 'text-base px-2.5 py-1',
  };

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'inline-flex items-center justify-center rounded font-semibold tabular-nums',
          sizeClasses[size]
        )}
        style={{
          backgroundColor: `${tierInfo.color}20`,
          color: tierInfo.color,
        }}
      >
        {displayScore}
      </span>
      {showLabel && (
        <span className="text-sm text-muted-foreground">{tierInfo.label}</span>
      )}
    </div>
  );
}
