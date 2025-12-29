'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface TraderInfo {
  address: string;
  tier: string;
  pnl_7d: number;
  win_rate: number;
  position_value: number;
  entry_price: number;
}

interface QualitySignal {
  id: number;
  coin: string;
  direction: string;
  elite_count: number;
  good_count: number;
  total_traders: number;
  traders: TraderInfo[];
  combined_pnl_7d: number;
  avg_win_rate: number;
  total_position_value: number;
  avg_entry_price: number;
  signal_strength: string;
  created_at: string;
  is_active: boolean;
}

interface SystemStats {
  elite_count: number;
  good_count: number;
  tracked_count: number;
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<QualitySignal[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedSignal, setExpandedSignal] = useState<number | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [filter, setFilter] = useState<string>('all');

  async function fetchData() {
    const supabase = createClient();
    
    // Fetch signals
    const signalsResult = await supabase
      .from('quality_signals')
      .select('*')
      .eq('is_active', true)
      .order('elite_count', { ascending: false })
      .order('total_traders', { ascending: false });
    
    if (!signalsResult.error && signalsResult.data) {
      setSignals(signalsResult.data);
    }
    
    // Fetch stats
    const statsResult = await supabase
      .from('system_stats')
      .select('stat_value')
      .eq('stat_name', 'quality')
      .single();
    
    if (!statsResult.error && statsResult.data) {
      setStats(statsResult.data.stat_value as SystemStats);
    }
    
    setIsLoading(false);
    setLastRefresh(new Date());
  }

  useEffect(function() {
    fetchData();
    const interval = setInterval(fetchData, 30 * 1000);
    return function() {
      clearInterval(interval);
    };
  }, []);

  function handleRefresh() {
    setIsLoading(true);
    fetchData();
  }

  function getTimeAgo(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return diffMins + 'm ago';
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return diffHours + 'h ago';
    return Math.floor(diffHours / 24) + 'd ago';
  }

  function formatPnl(value: number): string {
    const absValue = Math.abs(value);
    if (absValue >= 1000000) {
      return (value >= 0 ? '+' : '-') + '$' + (absValue / 1000000).toFixed(1) + 'M';
    }
    if (absValue >= 1000) {
      return (value >= 0 ? '+' : '-') + '$' + (absValue / 1000).toFixed(0) + 'K';
    }
    return (value >= 0 ? '+' : '-') + '$' + absValue.toFixed(0);
  }

  function formatValue(value: number): string {
    if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return '$' + (value / 1000).toFixed(0) + 'K';
    return '$' + value.toFixed(0);
  }

  function shortenAddress(addr: string): string {
    return addr.slice(0, 6) + '...' + addr.slice(-4);
  }

  function getTraderUrl(wallet: string): string {
    return 'https://app.hyperliquid.xyz/explorer/address/' + wallet;
  }

  const filteredSignals = signals.filter(function(s) {
    if (filter === 'all') return true;
    if (filter === 'strong') return s.signal_strength === 'strong';
    if (filter === 'long') return s.direction === 'long';
    if (filter === 'short') return s.direction === 'short';
    return true;
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-foreground">Quality Signals</h1>
              <p className="text-sm text-muted-foreground">
                Convergence from verified profitable traders
              </p>
            </div>
            <div className="flex items-center gap-4">
              {stats && (
                <div className="text-sm text-muted-foreground">
                  <span className="text-green-500">{stats.elite_count}</span> Elite
                  <span className="mx-2">|</span>
                  <span className="text-blue-500">{stats.good_count}</span> Good
                  <span className="mx-2">|</span>
                  {stats.tracked_count} Tracked
                </div>
              )}
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 disabled:opacity-50 rounded-md transition-colors"
              >
                {isLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Filters */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={function() { setFilter('all'); }}
            className={'px-3 py-1.5 text-sm rounded-md transition-colors ' + (filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-secondary/80')}
          >
            All
          </button>
          <button
            onClick={function() { setFilter('strong'); }}
            className={'px-3 py-1.5 text-sm rounded-md transition-colors ' + (filter === 'strong' ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-secondary/80')}
          >
            Strong Only
          </button>
          <button
            onClick={function() { setFilter('long'); }}
            className={'px-3 py-1.5 text-sm rounded-md transition-colors ' + (filter === 'long' ? 'bg-green-600 text-white' : 'bg-secondary hover:bg-secondary/80')}
          >
            Longs
          </button>
          <button
            onClick={function() { setFilter('short'); }}
            className={'px-3 py-1.5 text-sm rounded-md transition-colors ' + (filter === 'short' ? 'bg-red-600 text-white' : 'bg-secondary hover:bg-secondary/80')}
          >
            Shorts
          </button>
        </div>

        {/* Signals */}
        {filteredSignals.length > 0 ? (
          <div className="space-y-4">
            {filteredSignals.map(function(signal) {
              const isExpanded = expandedSignal === signal.id;
              
              return (
                <Card key={signal.id} className="overflow-hidden">
                  <CardContent className="p-0">
                    <div className="flex">
                      {/* Left - Coin/Direction */}
                      <div className={'w-24 flex flex-col items-center justify-center p-4 ' + (signal.direction === 'long' ? 'bg-green-500/10' : 'bg-red-500/10')}>
                        <span className="text-xl font-bold">{signal.coin}</span>
                        <span className={'text-xs font-medium px-2 py-0.5 rounded mt-1 ' + (signal.direction === 'long' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500')}>
                          {signal.direction.toUpperCase()}
                        </span>
                      </div>

                      {/* Right - Details */}
                      <div className="flex-1 p-4">
                        {/* Top row */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <span className="font-medium">
                              {signal.elite_count > 0 && (
                                <span className="text-green-500">{signal.elite_count} Elite</span>
                              )}
                              {signal.elite_count > 0 && signal.good_count > 0 && ' + '}
                              {signal.good_count > 0 && (
                                <span className="text-blue-500">{signal.good_count} Good</span>
                              )}
                            </span>
                            <Badge variant={signal.signal_strength === 'strong' ? 'default' : 'secondary'}>
                              {signal.signal_strength.toUpperCase()}
                            </Badge>
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {getTimeAgo(signal.created_at)}
                          </span>
                        </div>

                        {/* Stats row */}
                        <div className="grid grid-cols-4 gap-4 text-sm mb-3">
                          <div>
                            <div className="text-muted-foreground text-xs">Combined 7d PnL</div>
                            <div className={'font-medium ' + (signal.combined_pnl_7d >= 0 ? 'text-green-500' : 'text-red-500')}>
                              {formatPnl(signal.combined_pnl_7d)}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground text-xs">Avg Win Rate</div>
                            <div className="font-medium">
                              {(signal.avg_win_rate * 100).toFixed(1)}%
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground text-xs">Total Value</div>
                            <div className="font-medium">
                              {formatValue(signal.total_position_value)}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground text-xs">Avg Entry</div>
                            <div className="font-medium">
                              ${signal.avg_entry_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        </div>

                        {/* Traders section */}
                        <div className="border-t border-border pt-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-muted-foreground">
                              Traders ({signal.total_traders})
                            </span>
                            <button
                              onClick={function() { setExpandedSignal(isExpanded ? null : signal.id); }}
                              className="text-xs text-primary hover:underline"
                            >
                              {isExpanded ? 'Show less' : 'Show all'}
                            </button>
                          </div>
                          
                          {isExpanded ? (
                            <div className="space-y-2">
                              {signal.traders.map(function(trader) {
                                return (
                                  <div key={trader.address} className="flex items-center justify-between text-sm py-1 border-b border-border last:border-0">
                                    <div className="flex items-center gap-2">
                                      <span className={'text-xs px-1.5 py-0.5 rounded ' + (trader.tier === 'elite' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500')}>
                                        {trader.tier.toUpperCase()}
                                      </span>
                                      <a
                                        href={getTraderUrl(trader.address)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-mono text-primary hover:underline"
                                      >
                                        {trader.address}
                                      </a>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                      <span className={trader.pnl_7d >= 0 ? 'text-green-500' : 'text-red-500'}>
                                        7d: {formatPnl(trader.pnl_7d)}
                                      </span>
                                      <span>WR: {(trader.win_rate * 100).toFixed(0)}%</span>
                                      <span>Pos: {formatValue(trader.position_value)}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {signal.traders.slice(0, 3).map(function(trader) {
                                return (
                                  <div key={trader.address} className="flex items-center gap-1 text-xs">
                                    <span className={'px-1 py-0.5 rounded ' + (trader.tier === 'elite' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500')}>
                                      {trader.tier[0].toUpperCase()}
                                    </span>
                                    <a
                                      href={getTraderUrl(trader.address)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-mono text-primary hover:underline"
                                    >
                                      {shortenAddress(trader.address)}
                                    </a>
                                    <span className={'text-xs ' + (trader.pnl_7d >= 0 ? 'text-green-500' : 'text-red-500')}>
                                      {formatPnl(trader.pnl_7d)}
                                    </span>
                                  </div>
                                );
                              })}
                              {signal.traders.length > 3 && (
                                <span className="text-xs text-muted-foreground">
                                  +{signal.traders.length - 3} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <h3 className="text-lg font-medium mb-2">No Active Signals</h3>
              <p className="text-muted-foreground text-sm">
                Signals appear when 2+ Elite or 3+ Good traders converge on the same position.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="flex items-center justify-center gap-2 mt-6 text-sm text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span>Live - Last updated {lastRefresh.toLocaleTimeString()}</span>
        </div>
      </main>
    </div>
  );
}