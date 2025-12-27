import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Skeleton className="h-8 w-96" />
          <Skeleton className="h-5 w-48 mt-2" />
        </div>
      </div>

      <Skeleton className="h-32" />

      <Card className="p-6">
        <Skeleton className="h-6 w-32 mb-4" />
        <Skeleton className="h-64" />
      </Card>

      <div>
        <Skeleton className="h-10 w-64 mb-4" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}
