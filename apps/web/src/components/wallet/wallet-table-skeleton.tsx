import { Skeleton } from '@/components/ui/skeleton';

export function WalletTableSkeleton() {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="bg-muted h-10" />
      {[...Array(10)].map((_, i) => (
        <div key={i} className="h-14 border-t border-border flex items-center gap-4 px-4">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-6 w-12 ml-auto" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-6 w-12" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
