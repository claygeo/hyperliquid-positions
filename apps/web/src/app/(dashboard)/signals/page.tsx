'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/common/loading-spinner';

interface ConvergenceSignal {
  id: number;
  coin: string;
  direction: 'long' | 'short';
  wallet_count: number;
  wallets: string[];
  avg_entry_price: number;
  total_value_usd: number;
  confidence: number;
  time_window_minutes: number;
  created_at: string;
  expires_at: string;
  is_active: boolean;
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<ConvergenceSignal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchSignals() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('convergence_signals')
        .select('*')
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString())
        .order('confidence', { ascending: false })
        .order('wallet_count', { ascending: false })
        .limit(50);

      if (!error && data) {
        setSignals(data);
      }
      setIsLoading(false);
    }

    fetchSignals();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchSignals, 30 * 1000);
    return () => clearInterval(interval);
  }, []);

  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  const shortenAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Convergence Signals</h1>
        <p className="text-muted-foreground mt-1">
          When 3+ top traders enter the same position
        </p>
      </div>

      {signals.length > 0 ? (
        <div className="grid gap-4">
          {signals.map((signal) => (
            <Card key={signal.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="flex items-stretch">
                  {/* Left side - Coin & Direction */}
                  <div className={`w-32 flex flex-col items-center justify-center p-4 ${
                    signal.direction === 'long' ? 'bg-green-500/10' : 'bg-red-500/10'
                  }`}>
                    <span className="text-2xl font-bold">{signal.coin}</span>
                    <Badge variant={signal.direction === 'long' ? 'default' : 'destructive'} className="mt-1">
                      {signal.direction.toUpperCase()}
                    </Badge>
                  </div>

                  {/* Right side - Details */}
                  <div className="flex-1 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-semibold">
                          {signal.wallet_count} traders converging
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {signal.confidence}% confidence
                        </Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {getTimeAgo(signal.created_at)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Avg Entry:</span>
                        <span className="ml-2 font-medium">
                          ${signal.avg_entry_price?.toLocaleString('en-US', { maximumFractionDigits: 2 }) || 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Total Value:</span>
                        <span className="ml-2 font-medium">
                          ${signal.total_value_usd?.toLocaleString('en-US', { maximumFractionDigits: 0 }) || 'N/A'}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t">
                      <span className="text-xs text-muted-foreground">Traders: </span>
                      <span className="text-xs font-mono">
                        {signal.wallets?.slice(0, 5).map(shortenAddress).join(', ')}
                        {signal.wallets?.length > 5 && ` +${signal.wallets.length - 5} more`}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="text-4xl mb-4">📊</div>
            <h3 className="text-lg font-medium mb-2">No Active Signals</h3>
            <p className="text-muted-foreground">
              Signals appear when 3+ top traders open the same position within 2 hours.
              <br />
              Check back soon!
            </p>
          </CardContent>
        </Card>
      )}

      {/* Live indicator */}
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
        </span>
        <span>Live - updates every 30 seconds</span>
      </div>
    </div>
  );
}