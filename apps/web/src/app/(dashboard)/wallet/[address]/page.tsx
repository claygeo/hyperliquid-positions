import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { WalletStats } from '@/components/wallet/wallet-stats';
import { WalletPositions } from '@/components/wallet/wallet-positions';
import { WalletTrades } from '@/components/wallet/wallet-trades';
import { WalletChart } from '@/components/wallet/wallet-chart';
import { AddressDisplay } from '@/components/common/address-display';
import { WalletScore } from '@/components/wallet/wallet-score';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface WalletPageProps {
  params: { address: string };
}

async function getWallet(address: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('address', address)
    .single();

  if (error || !data) return null;
  return data;
}

export default async function WalletPage({ params }: WalletPageProps) {
  const wallet = await getWallet(params.address);

  if (!wallet) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">
              <AddressDisplay address={wallet.address} full />
            </h1>
            <WalletScore score={wallet.overall_score} size="lg" />
          </div>
          <p className="text-muted-foreground mt-1">
            First seen: {new Date(wallet.first_seen).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Stats */}
      <Suspense fallback={<Skeleton className="h-32" />}>
        <WalletStats wallet={wallet} />
      </Suspense>

      {/* Chart */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Performance</h2>
        <Suspense fallback={<Skeleton className="h-64" />}>
          <WalletChart address={wallet.address} />
        </Suspense>
      </Card>

      {/* Tabs for Positions and Trades */}
      <Tabs defaultValue="positions" className="w-full">
        <TabsList>
          <TabsTrigger value="positions">Positions</TabsTrigger>
          <TabsTrigger value="trades">Recent Trades</TabsTrigger>
        </TabsList>
        
        <TabsContent value="positions" className="mt-4">
          <Suspense fallback={<Skeleton className="h-48" />}>
            <WalletPositions address={wallet.address} />
          </Suspense>
        </TabsContent>
        
        <TabsContent value="trades" className="mt-4">
          <Suspense fallback={<Skeleton className="h-48" />}>
            <WalletTrades address={wallet.address} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
