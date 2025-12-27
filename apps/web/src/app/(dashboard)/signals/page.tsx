'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/common/loading-spinner';

interface ConvergenceSignal {
  id: number;
  coin: string;
  direction: string;
  wallet_count: number;
  wallets: string[];
  avg_entry_price: number;
  total_value_usd: number;
  confidence: number;
  signal_strength: string;
  fresh_entries: number;
  winning_count: number;
  losing_count: number;
  avg_return_pct: number;
  avg_position_pct: number;
  freshness_minutes: number;
  created_at: string;
  expires_at: string;
  is_active: boolean;
}

export default function SignalsPage() {
  var [signals, setSignals] = useState<ConvergenceSignal[]>([]);
  var [isLoading, setIsLoading] = useState(true);
  var [expandedSignal, setExpandedSignal] = useState<number | null>(null);
  var [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  var [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  var [filter, setFilter] = useState<string>('all');

  function fetchSignals() {
    var supabase = createClient();
    supabase
      .from('convergence_signals')
      .select('*')
      .eq('is_active', true)
      .gte('confidence', 40)
      .gt('expires_at', new Date().toISOString())
      .order('confidence', { ascending: false })
      .order('wallet_count', { ascending: false })
      .limit(50)
      .then(function(result) {
        if (!result.error && result.data) {
          setSignals(result.data);
        }
        setIsLoading(false);
        setLastRefresh(new Date());
      });
  }

  useEffect(function() {
    fetchSignals();
    
    var interval = setInterval(fetchSignals, 30 * 1000);
    return function() {
      clearInterval(interval);
    };
  }, []);

  function handleRefresh() {
    setIsLoading(true);
    fetchSignals();
  }

  function getTimeAgo(dateString: string): string {
    var date = new Date(dateString);
    var now = new Date();
    var diffMs = now.getTime() - date.getTime();
    var diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return diffMins + 'm ago';
    var diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return diffHours + 'h ago';
    return Math.floor(diffHours / 24) + 'd ago';
  }

  function shortenAddress(addr: string): string {
    return addr.slice(0, 6) + '...' + addr.slice(-4);
  }

  function formatPrice(price: number | null): string {
    if (!price) return 'N/A';
    return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function formatValue(value: number | null): string {
    if (!value) return 'N/A';
    if (value >= 1000000) {
      return '$' + (value / 1000000).toFixed(1) + 'M';
    }
    if (value >= 1000) {
      return '$' + (value / 1000).toFixed(0) + 'K';
    }
    return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function getDirectionBgClass(direction: string): string {
    if (direction === 'long') {
      return 'w-28 flex flex-col items-center justify-center p-4 bg-green-500/10';
    }
    return 'w-28 flex flex-col items-center justify-center p-4 bg-red-500/10';
  }

  function getStrengthClass(strength: string): string {
    if (strength === 'very_strong') {
      return 'bg-green-600 text-white';
    }
    if (strength === 'strong') {
      return 'bg-blue-600 text-white';
    }
    if (strength === 'medium') {
      return 'bg-yellow-600 text-white';
    }
    return 'bg-gray-600 text-white';
  }

  function getStrengthLabel(strength: string, confidence: number): string {
    var label = (strength || 'medium').replace('_', ' ').toUpperCase();
    return label + ' (' + confidence + '%)';
  }

  function getTraderUrl(wallet: string): string {
    return 'https://legacy.hyperdash.com/trader/' + wallet;
  }

  function copyToClipboard(address: string): void {
    navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(function() {
      setCopiedAddress(null);
    }, 2000);
  }

  function toggleExpanded(signalId: number): void {
    if (expandedSignal === signalId) {
      setExpandedSignal(null);
    } else {
      setExpandedSignal(signalId);
    }
  }

  function formatLastRefresh(): string {
    return lastRefresh.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function getWinLossColor(winning: number, losing: number): string {
    var total = winning + losing;
    if (total === 0) return 'text-muted-foreground';
    var winPct = (winning / total) * 100;
    if (winPct >= 60) return 'text-green-500';
    if (winPct >= 40) return 'text-yellow-500';
    return 'text-red-500';
  }

  function getReturnColor(returnPct: number): string {
    if (returnPct >= 0) return 'text-green-500';
    return 'text-red-500';
  }

  function getFilterClass(currentFilter: string, buttonFilter: string, color: string): string {
    if (currentFilter === buttonFilter) {
      return 'px-3 py-1 rounded-md text-sm ' + color + ' text-white';
    }
    return 'px-3 py-1 rounded-md text-sm bg-muted hover:bg-muted/80';
  }

  // Filter signals
  var filteredSignals = signals.filter(function(s) {
    if (filter === 'all') return true;
    if (filter === 'strong') return s.signal_strength === 'strong' || s.signal_strength === 'very_strong';
    if (filter === 'long') return s.direction === 'long';
    if (filter === 'short') return s.direction === 'short';
    return true;
  });

  if (isLoading && signals.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Convergence Signals</h1>
          <p className="text-muted-foreground mt-1">
            Smart signals from top traders (BTC, ETH, SOL + majors)
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-md text-sm flex items-center gap-2"
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
          <span className="text-xs text-muted-foreground">
            Last: {formatLastRefresh()}
          </span>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={function() { setFilter('all'); }}
          className={getFilterClass(filter, 'all', 'bg-blue-600')}
        >
          All
        </button>
        <button
          onClick={function() { setFilter('strong'); }}
          className={getFilterClass(filter, 'strong', 'bg-purple-600')}
        >
          Strong Only
        </button>
        <button
          onClick={function() { setFilter('long'); }}
          className={getFilterClass(filter, 'long', 'bg-green-600')}
        >
          Longs
        </button>
        <button
          onClick={function() { setFilter('short'); }}
          className={getFilterClass(filter, 'short', 'bg-red-600')}
        >
          Shorts
        </button>
      </div>

      {filteredSignals.length > 0 ? (
        <div className="grid gap-4">
          {filteredSignals.map(function(signal) {
            var isExpanded = expandedSignal === signal.id;
            var winCount = signal.winning_count || 0;
            var loseCount = signal.losing_count || 0;
            var totalTraders = winCount + loseCount;
            var winPct = totalTraders > 0 ? Math.round((winCount / totalTraders) * 100) : 0;
            var avgReturn = signal.avg_return_pct || 0;
            var avgPosition = signal.avg_position_pct || 0;
            var freshEntries = signal.fresh_entries || 0;
            var freshness = signal.freshness_minutes || 0;
            
            return (
              <Card key={signal.id} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex items-stretch">
                    <div className={getDirectionBgClass(signal.direction)}>
                      <span className="text-2xl font-bold">{signal.coin}</span>
                      <Badge variant={signal.direction === 'long' ? 'default' : 'destructive'} className="mt-1">
                        {signal.direction.toUpperCase()}
                      </Badge>
                    </div>

                    <div className="flex-1 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-lg font-semibold">
                            {freshEntries} fresh entries
                          </span>
                          <span className="text-sm text-muted-foreground">
                            ({signal.wallet_count} total)
                          </span>
                          <span className={'px-2 py-0.5 rounded text-xs font-medium ' + getStrengthClass(signal.signal_strength || 'medium')}>
                            {getStrengthLabel(signal.signal_strength, signal.confidence)}
                          </span>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {getTimeAgo(signal.created_at)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                        <div>
                          <span className="text-muted-foreground block text-xs">Win/Loss</span>
                          <span className={'font-medium ' + getWinLossColor(winCount, loseCount)}>
                            {winCount}/{totalTraders} winning ({winPct}%)
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">Avg Return</span>
                          <span className={'font-medium ' + getReturnColor(avgReturn)}>
                            {avgReturn >= 0 ? '+' : ''}{avgReturn.toFixed(1)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">Avg Position</span>
                          <span className="font-medium">
                            {avgPosition.toFixed(1)}% of acct
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">Total Value</span>
                          <span className="font-medium">{formatValue(signal.total_value_usd)}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-muted-foreground">Avg Entry: </span>
                          <span className="font-medium">{formatPrice(signal.avg_entry_price)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Latest entry: </span>
                          <span className="font-medium">{freshness}m ago</span>
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-muted-foreground">
                            Traders ({signal.wallets ? signal.wallets.length : 0}):
                          </span>
                          <button
                            onClick={function() { toggleExpanded(signal.id); }}
                            className="text-xs text-blue-500 hover:text-blue-400"
                          >
                            {isExpanded ? 'Show less' : 'Show all'}
                          </button>
                        </div>
                        
                        {isExpanded ? (
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {signal.wallets && signal.wallets.map(function(wallet) {
                              return (
                                <div key={wallet} className="flex items-center gap-2 text-xs">
                                  <a
                                    href={getTraderUrl(wallet)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-blue-500 hover:text-blue-400 hover:underline"
                                  >
                                    {wallet}
                                  </a>
                                  <button
                                    onClick={function() { copyToClipboard(wallet); }}
                                    className="text-muted-foreground hover:text-foreground px-1"
                                    title="Copy address"
                                  >
                                    {copiedAddress === wallet ? '✓' : '📋'}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {signal.wallets && signal.wallets.slice(0, 5).map(function(wallet) {
                              return (
                                <a
                                  key={wallet}
                                  href={getTraderUrl(wallet)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs font-mono text-blue-500 hover:text-blue-400 hover:underline"
                                >
                                  {shortenAddress(wallet)}
                                </a>
                              );
                            })}
                            {signal.wallets && signal.wallets.length > 5 && (
                              <button
                                onClick={function() { toggleExpanded(signal.id); }}
                                className="text-xs text-muted-foreground hover:text-foreground"
                              >
                                +{signal.wallets.length - 5} more
                              </button>
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
            <div className="text-4xl mb-4">📊</div>
            <h3 className="text-lg font-medium mb-2">No Active Signals</h3>
            <p className="text-muted-foreground">
              Signals appear when 3+ top traders enter the same position with at least 2 fresh entries.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
        </span>
        <span>Live - auto-refreshes every 30 seconds</span>
      </div>
    </div>
  );
}