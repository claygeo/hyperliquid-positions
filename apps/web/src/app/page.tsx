'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, LogIn, LogOut } from 'lucide-react';

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
  updated_at: string;
  is_active: boolean;
}

interface HistoryEvent {
  id: number;
  address: string;
  event_type: 'opened' | 'closed';
  quality_tier: string;
  pnl_7d: number;
  pnl_realized: number | null;
  position_value: number;
  created_at: string;
}

interface SignalHistory {
  opened: HistoryEvent[];
  closed: HistoryEvent[];
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
  const [expandedNewTrades, setExpandedNewTrades] = useState<number | null>(null);
  const [expandedClosedTrades, setExpandedClosedTrades] = useState<number | null>(null);
  const [signalHistory, setSignalHistory] = useState<Record<string, SignalHistory>>({});
  const [lastRefresh, setLastRefresh] = useState<string>('--:--:--');
  const [filter, setFilter] = useState<string>('all');
  const [mounted, setMounted] = useState(false);

  // Handle hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch history for a specific signal when expanded
  const fetchHistory = useCallback(async (coin: string, direction: string) => {
    const key = `${coin}-${direction}`;
    
    const supabase = createClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    try {
      const { data, error } = await supabase
        .from('signal_position_history')
        .select('*')
        .eq('coin', coin)
        .eq('direction', direction)
        .gte('created_at', since)
        .order('created_at', { ascending: false });
      
      if (!error && data) {
        setSignalHistory(prev => ({
          ...prev,
          [key]: {
            opened: data.filter((e: HistoryEvent) => e.event_type === 'opened'),
            closed: data.filter((e: HistoryEvent) => e.event_type === 'closed'),
          }
        }));
      }
    } catch (err) {
      // Table might not exist yet, that's ok
      console.log('History table not available yet');
    }
  }, []);

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
    
    // Fetch stats from trader_quality table directly
    const eliteResult = await supabase
      .from('trader_quality')
      .select('address', { count: 'exact', head: true })
      .eq('quality_tier', 'elite');
    
    const goodResult = await supabase
      .from('trader_quality')
      .select('address', { count: 'exact', head: true })
      .eq('quality_tier', 'good');
    
    const trackedResult = await supabase
      .from('trader_quality')
      .select('address', { count: 'exact', head: true })
      .eq('is_tracked', true);
    
    setStats({
      elite_count: eliteResult.count || 0,
      good_count: goodResult.count || 0,
      tracked_count: trackedResult.count || 0,
    });
    
    setIsLoading(false);
    setLastRefresh(new Date().toLocaleTimeString());
  }

  useEffect(() => {
    if (mounted) {
      fetchData();
      const interval = setInterval(fetchData, 30 * 1000);
      return () => clearInterval(interval);
    }
  }, [mounted]);

  function handleRefresh() {
    setIsLoading(true);
    setSignalHistory({}); // Clear history cache on refresh
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
    if (value === null || value === undefined) return '$0';
    const absValue = Math.abs(value);
    if (absValue >= 1000000) {
      return (value >= 0 ? '+' : '-') + '$' + (absValue / 1000000).toFixed(1) + 'M';
    }
    if (absValue >= 1000) {
      return (value >= 0 ? '+' : '-') + '$' + (absValue / 1000).toFixed(0) + 'K';
    }
    return (value >= 0 ? '+' : '') + '$' + value.toFixed(0);
  }

  function formatValue(value: number): string {
    if (!value) return '$0';
    if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return '$' + (value / 1000).toFixed(0) + 'K';
    return '$' + value.toFixed(0);
  }

  function shortenAddress(addr: string): string {
    if (!addr) return '';
    return addr.slice(0, 6) + '...' + addr.slice(-4);
  }

  function getTraderUrl(wallet: string): string {
    return 'https://hypurrscan.io/address/' + wallet;
  }

  // Toggle new trades section
  function toggleNewTrades(signalId: number, coin: string, direction: string) {
    if (expandedNewTrades === signalId) {
      setExpandedNewTrades(null);
    } else {
      setExpandedNewTrades(signalId);
      setExpandedClosedTrades(null); // Close the other one
      fetchHistory(coin, direction);
    }
  }

  // Toggle closed trades section
  function toggleClosedTrades(signalId: number, coin: string, direction: string) {
    if (expandedClosedTrades === signalId) {
      setExpandedClosedTrades(null);
    } else {
      setExpandedClosedTrades(signalId);
      setExpandedNewTrades(null); // Close the other one
      fetchHistory(coin, direction);
    }
  }

  const filteredSignals = signals.filter((s) => {
    if (filter === 'all') return true;
    if (filter === 'strong') return s.signal_strength === 'strong';
    if (filter === 'long') return s.direction === 'long';
    if (filter === 'short') return s.direction === 'short';
    return true;
  });

  // Don't render until mounted (prevents hydration mismatch)
  if (!mounted) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border">
          <div className="max-w-6xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold text-foreground">Quality Signals</h1>
                <p className="text-sm text-muted-foreground">
                  Convergence from verified profitable traders
                </p>
              </div>
            </div>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex justify-center py-12">
            <div className="text-muted-foreground">Loading...</div>
          </div>
        </main>
      </div>
    );
  }

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
                  <span className="text-green-500 font-medium">{stats.elite_count} Elite</span>
                  <span className="mx-1">|</span>
                  <span className="text-blue-500 font-medium">{stats.good_count} Good</span>
                  <span className="mx-1">|</span>
                  <span className="font-medium">{stats.tracked_count} Tracked</span>
                </div>
              )}
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded-md transition-colors disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Filters */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setFilter('all')}
            className={'px-3 py-1.5 text-sm rounded-md transition-colors ' + (filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-secondary/80')}
          >
            All
          </button>
          <button
            onClick={() => setFilter('strong')}
            className={'px-3 py-1.5 text-sm rounded-md transition-colors ' + (filter === 'strong' ? 'bg-yellow-600 text-white' : 'bg-secondary hover:bg-secondary/80')}
          >
            Strong Only
          </button>
          <button
            onClick={() => setFilter('long')}
            className={'px-3 py-1.5 text-sm rounded-md transition-colors ' + (filter === 'long' ? 'bg-green-600 text-white' : 'bg-secondary hover:bg-secondary/80')}
          >
            Longs
          </button>
          <button
            onClick={() => setFilter('short')}
            className={'px-3 py-1.5 text-sm rounded-md transition-colors ' + (filter === 'short' ? 'bg-red-600 text-white' : 'bg-secondary hover:bg-secondary/80')}
          >
            Shorts
          </button>
        </div>

        {/* Signals */}
        {filteredSignals.length > 0 ? (
          <div className="space-y-4">
            {filteredSignals.map((signal) => {
              const isExpanded = expandedSignal === signal.id;
              const traders = Array.isArray(signal.traders) ? signal.traders : [];
              const historyKey = `${signal.coin}-${signal.direction}`;
              const history = signalHistory[historyKey] || { opened: [], closed: [] };
              const isNewTradesOpen = expandedNewTrades === signal.id;
              const isClosedTradesOpen = expandedClosedTrades === signal.id;
              
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
                              {signal.elite_count === 0 && signal.good_count === 0 && (
                                <span>{signal.total_traders} Traders</span>
                              )}
                            </span>
                            <Badge variant={signal.signal_strength === 'strong' ? 'default' : 'secondary'}>
                              {(signal.signal_strength || 'medium').toUpperCase()}
                            </Badge>
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {getTimeAgo(signal.updated_at || signal.created_at)}
                          </span>
                        </div>

                        {/* Stats row */}
                        <div className="grid grid-cols-4 gap-4 text-sm mb-3">
                          <div>
                            <div className="text-muted-foreground text-xs">Combined 7d PnL</div>
                            <div className={'font-medium ' + ((signal.combined_pnl_7d || 0) >= 0 ? 'text-green-500' : 'text-red-500')}>
                              {formatPnl(signal.combined_pnl_7d || 0)}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground text-xs">Avg Win Rate</div>
                            <div className="font-medium">
                              {((signal.avg_win_rate || 0) * 100).toFixed(1)}%
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground text-xs">Total Value</div>
                            <div className="font-medium">
                              {formatValue(signal.total_position_value || 0)}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground text-xs">Avg Entry</div>
                            <div className="font-medium">
                              ${(signal.avg_entry_price || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        </div>

                        {/* Active Traders section */}
                        <div className="border-t border-border pt-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-muted-foreground">
                              Traders ({signal.total_traders})
                            </span>
                            {traders.length > 0 && (
                              <button
                                onClick={() => setExpandedSignal(isExpanded ? null : signal.id)}
                                className="text-xs text-primary hover:underline"
                              >
                                {isExpanded ? 'Show less' : 'Show all'}
                              </button>
                            )}
                          </div>
                          
                          {isExpanded && traders.length > 0 ? (
                            <div className="space-y-2">
                              {traders.map((trader) => (
                                <div key={trader.address} className="flex items-center justify-between text-sm py-1 border-b border-border last:border-0">
                                  <div className="flex items-center gap-2">
                                    <span className={'text-xs px-1.5 py-0.5 rounded ' + (trader.tier === 'elite' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500')}>
                                      {(trader.tier || 'good').toUpperCase()}
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
                                    <span className={(trader.pnl_7d || 0) >= 0 ? 'text-green-500' : 'text-red-500'}>
                                      7d: {formatPnl(trader.pnl_7d || 0)}
                                    </span>
                                    <span>WR: {((trader.win_rate || 0) * 100).toFixed(0)}%</span>
                                    <span>Pos: {formatValue(trader.position_value || 0)}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : traders.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {traders.slice(0, 3).map((trader) => (
                                <div key={trader.address} className="flex items-center gap-1 text-xs">
                                  <span className={'px-1 py-0.5 rounded ' + (trader.tier === 'elite' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500')}>
                                    {(trader.tier || 'G')[0].toUpperCase()}
                                  </span>
                                  <a
                                    href={getTraderUrl(trader.address)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-primary hover:underline"
                                  >
                                    {shortenAddress(trader.address)}
                                  </a>
                                  <span className={'text-xs ' + ((trader.pnl_7d || 0) >= 0 ? 'text-green-500' : 'text-red-500')}>
                                    {formatPnl(trader.pnl_7d || 0)}
                                  </span>
                                </div>
                              ))}
                              {traders.length > 3 && (
                                <span className="text-xs text-muted-foreground">
                                  +{traders.length - 3} more
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">No trader details available</div>
                          )}
                        </div>

                        {/* New Trades Section (Collapsible) */}
                        <div className="border-t border-border mt-3 pt-3">
                          <button
                            onClick={() => toggleNewTrades(signal.id, signal.coin, signal.direction)}
                            className="flex items-center gap-2 w-full text-left hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors"
                          >
                            {isNewTradesOpen ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                            <LogIn className="h-4 w-4 text-green-500" />
                            <span className="text-xs font-medium">New Trades</span>
                            <span className="text-xs text-muted-foreground">
                              ({history.opened.length > 0 ? history.opened.length : '?'})
                            </span>
                            <span className="text-xs text-muted-foreground ml-auto">Last 24h</span>
                          </button>
                          
                          {isNewTradesOpen && (
                            <div className="mt-2 pl-6 space-y-1">
                              {history.opened.length === 0 ? (
                                <div className="text-xs text-muted-foreground py-2">
                                  No new entries in last 24h
                                </div>
                              ) : (
                                history.opened.map((event) => (
                                  <div key={event.id} className="flex items-center justify-between text-xs py-1">
                                    <div className="flex items-center gap-2">
                                      <span className={'px-1 py-0.5 rounded ' + (event.quality_tier === 'elite' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500')}>
                                        {event.quality_tier === 'elite' ? 'E' : 'G'}
                                      </span>
                                      <a
                                        href={getTraderUrl(event.address)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-mono text-primary hover:underline"
                                      >
                                        {shortenAddress(event.address)}
                                      </a>
                                      {event.pnl_7d > 0 && (
                                        <span className="text-green-500">+{formatPnl(event.pnl_7d)}</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                      {event.position_value > 0 && (
                                        <span>{formatValue(event.position_value)}</span>
                                      )}
                                      <span>{getTimeAgo(event.created_at)}</span>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>

                        {/* Closed Trades Section (Collapsible) */}
                        <div className="border-t border-border mt-3 pt-3">
                          <button
                            onClick={() => toggleClosedTrades(signal.id, signal.coin, signal.direction)}
                            className="flex items-center gap-2 w-full text-left hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors"
                          >
                            {isClosedTradesOpen ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                            <LogOut className="h-4 w-4 text-red-500" />
                            <span className="text-xs font-medium">Closed Trades</span>
                            <span className="text-xs text-muted-foreground">
                              ({history.closed.length > 0 ? history.closed.length : '?'})
                            </span>
                            <span className="text-xs text-muted-foreground ml-auto">Last 24h</span>
                          </button>
                          
                          {isClosedTradesOpen && (
                            <div className="mt-2 pl-6 space-y-1">
                              {history.closed.length === 0 ? (
                                <div className="text-xs text-muted-foreground py-2">
                                  No exits in last 24h
                                </div>
                              ) : (
                                history.closed.map((event) => (
                                  <div key={event.id} className="flex items-center justify-between text-xs py-1">
                                    <div className="flex items-center gap-2">
                                      <span className={'px-1 py-0.5 rounded ' + (event.quality_tier === 'elite' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500')}>
                                        {event.quality_tier === 'elite' ? 'E' : 'G'}
                                      </span>
                                      <a
                                        href={getTraderUrl(event.address)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-mono text-primary hover:underline"
                                      >
                                        {shortenAddress(event.address)}
                                      </a>
                                      {event.pnl_realized !== null && (
                                        <span className={event.pnl_realized >= 0 ? 'text-green-500' : 'text-red-500'}>
                                          {event.pnl_realized >= 0 ? '+' : ''}{formatPnl(event.pnl_realized)}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                      {event.position_value > 0 && (
                                        <span>{formatValue(event.position_value)}</span>
                                      )}
                                      <span>{getTimeAgo(event.created_at)}</span>
                                    </div>
                                  </div>
                                ))
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
              <p className="text-muted-foreground text-sm mb-4">
                Signals appear when 2+ Elite or 3+ Good traders converge on the same position.
              </p>
              <p className="text-muted-foreground text-xs">
                The system is discovering and analyzing wallets. This may take a few minutes.
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
          <span>Live - Last updated {lastRefresh}</span>
        </div>
      </main>
    </div>
  );
}