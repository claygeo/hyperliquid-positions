'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { 
  ChevronDown, 
  ChevronUp, 
  Copy, 
  Check,
  Zap,
  Clock,
  ExternalLink
} from 'lucide-react';

// ============================================
// TYPES
// ============================================

interface TraderInfo {
  address: string;
  tier: string;
  pnl_7d: number;
  win_rate: number;
  position_value: number;
  entry_price: number;
  conviction_pct?: number;
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
  signal_strength: string;
  confidence: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  take_profit_3: number;
  funding_context: string;
  avg_conviction_pct: number;
  entry_price: number;
  current_price: number;
  current_pnl_pct: number;
  stop_distance_pct: number;
  avg_entry_price: number;
  created_at: string;
  updated_at: string;
}

interface SystemStats {
  elite_count: number;
  good_count: number;
  tracked_count: number;
}

interface SignalStats {
  total: number;
  wins: number;
  stopped: number;
  open: number;
  win_rate: number;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function formatPnl(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function formatPrice(price: number): string {
  if (!price) return '-';
  if (price >= 1000) return '$' + price.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (price >= 1) return '$' + price.toFixed(2);
  if (price >= 0.01) return '$' + price.toFixed(4);
  return '$' + price.toFixed(6);
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function getTraderUrl(address: string): string {
  return `https://legacy.hyperdash.io/trader/${address}`;
}

// ============================================
// SIGNAL PERFORMANCE SUMMARY
// ============================================

function SignalPerformanceSummary({ stats }: { stats: SignalStats | null }) {
  if (!stats || stats.total === 0) return null;
  
  const closedCount = stats.total - stats.open;
  if (closedCount === 0) return null;
  
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-sm bg-muted/30 rounded-lg px-3 sm:px-4 py-2 mb-4 sm:mb-6">
      <span className="text-muted-foreground">Track Record:</span>
      <span className="font-medium">{closedCount} closed</span>
      <span className="text-muted-foreground hidden sm:inline">·</span>
      <span className={stats.win_rate >= 50 ? 'text-green-500 font-medium' : 'text-red-500 font-medium'}>
        {stats.win_rate.toFixed(0)}% win rate
      </span>
      <span className="text-muted-foreground hidden sm:inline">·</span>
      <span className="text-green-500">{stats.wins} TP</span>
      <span className="text-muted-foreground hidden sm:inline">·</span>
      <span className="text-red-500">{stats.stopped} stopped</span>
    </div>
  );
}

// ============================================
// COPY TRADE BUTTON
// ============================================

function CopyTradeButton({ signal }: { signal: QualitySignal }) {
  const [copied, setCopied] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const copyValue = async (value: string | number) => {
    await navigator.clipboard.writeText(String(value));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setShowDropdown(false);
  };

  const entryPrice = signal.entry_price || signal.current_price;

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy Trade'}</span>
        <span className="sm:hidden">{copied ? 'Copied!' : 'Copy'}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
      </button>
      
      {showDropdown && (
        <div className="absolute right-0 mt-2 w-48 bg-popover border border-border rounded-lg shadow-lg z-10 py-1">
          <button
            onClick={() => copyValue(entryPrice)}
            className="w-full px-4 py-2 text-left text-sm hover:bg-muted flex justify-between"
          >
            <span>Entry Price</span>
            <span className="text-muted-foreground font-mono">{formatPrice(entryPrice)}</span>
          </button>
          <button
            onClick={() => copyValue(signal.stop_loss)}
            className="w-full px-4 py-2 text-left text-sm hover:bg-muted flex justify-between"
          >
            <span>Stop Loss</span>
            <span className="text-red-500 font-mono">{formatPrice(signal.stop_loss)}</span>
          </button>
          <button
            onClick={() => copyValue(signal.take_profit_1)}
            className="w-full px-4 py-2 text-left text-sm hover:bg-muted flex justify-between"
          >
            <span>Take Profit 1</span>
            <span className="text-green-500 font-mono">{formatPrice(signal.take_profit_1)}</span>
          </button>
          <div className="border-t border-border my-1" />
          <button
            onClick={() => copyValue(signal.take_profit_2)}
            className="w-full px-4 py-2 text-left text-sm hover:bg-muted flex justify-between text-muted-foreground"
          >
            <span>Take Profit 2</span>
            <span className="font-mono">{formatPrice(signal.take_profit_2)}</span>
          </button>
          <button
            onClick={() => copyValue(signal.take_profit_3)}
            className="w-full px-4 py-2 text-left text-sm hover:bg-muted flex justify-between text-muted-foreground"
          >
            <span>Take Profit 3</span>
            <span className="font-mono">{formatPrice(signal.take_profit_3)}</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================
// SIGNAL STORY - The main narrative
// ============================================

function SignalStory({ signal }: { signal: QualitySignal }) {
  const traders = Array.isArray(signal.traders) ? signal.traders : [];
  
  const eliteTraders = traders.filter(t => t.tier === 'elite');
  const goodTraders = traders.filter(t => t.tier === 'good');
  
  const leadTrader = eliteTraders.length > 0 
    ? eliteTraders.reduce((best, t) => (t.pnl_7d || 0) > (best.pnl_7d || 0) ? t : best)
    : goodTraders.length > 0
    ? goodTraders.reduce((best, t) => (t.pnl_7d || 0) > (best.pnl_7d || 0) ? t : best)
    : null;

  const isLong = signal.direction === 'long';
  const actionWord = isLong ? 'going long on' : 'shorting';
  
  const leadConviction = leadTrader?.conviction_pct;
  const convictionText = leadConviction && leadConviction >= 20 
    ? ` with ${leadConviction.toFixed(0)}% of their account`
    : '';

  const otherElite = signal.elite_count - (leadTrader?.tier === 'elite' ? 1 : 0);
  const otherGood = signal.good_count - (leadTrader?.tier === 'good' ? 1 : 0);

  return (
    <div className="space-y-1">
      {leadTrader && (
        <p className="text-sm leading-relaxed">
          <span className={leadTrader.tier === 'elite' ? 'text-green-500 font-semibold' : 'text-blue-500 font-semibold'}>
            {leadTrader.tier === 'elite' ? 'An Elite' : 'A Good'} trader
          </span>
          {' '}
          <span className="text-muted-foreground">
            ({formatPnl(leadTrader.pnl_7d || 0)} this week, {((leadTrader.win_rate || 0) * 100).toFixed(0)}% WR)
          </span>
          {' '}
          <span>
            is {actionWord} {signal.coin}{convictionText}
          </span>
        </p>
      )}
      
      {(otherElite > 0 || otherGood > 0) && (
        <p className="text-sm text-muted-foreground">
          {otherElite > 0 && (
            <span className="text-green-500">+{otherElite} Elite</span>
          )}
          {otherElite > 0 && otherGood > 0 && ' and '}
          {otherGood > 0 && (
            <span className="text-blue-500">+{otherGood} Good</span>
          )}
          {' '}trader{(otherElite + otherGood) > 1 ? 's' : ''} agree
        </p>
      )}
    </div>
  );
}

// ============================================
// PRICE DISPLAY
// ============================================

function PriceDisplay({ signal }: { signal: QualitySignal }) {
  const entry = signal.entry_price || signal.current_price;
  const current = signal.current_price;
  const pnlPct = signal.current_pnl_pct || 0;
  const isProfit = pnlPct > 0;
  
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Entry</span>
        <span className="font-mono font-medium">{formatPrice(entry)}</span>
        <span className="text-muted-foreground hidden sm:inline">→</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Now</span>
        <span className="font-mono font-medium">{formatPrice(current)}</span>
        <span className={`font-medium ${isProfit ? 'text-green-500' : 'text-red-500'}`}>
          ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
        </span>
      </div>
    </div>
  );
}

// ============================================
// SIGNAL CARD
// ============================================

function SignalCard({ signal, isExpanded, onToggle }: { 
  signal: QualitySignal; 
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const traders = Array.isArray(signal.traders) ? signal.traders : [];
  const isLong = signal.direction === 'long';
  const stopPct = signal.stop_distance_pct || Math.abs((signal.stop_loss - signal.entry_price) / signal.entry_price * 100);
  
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Collapsed View */}
        <div 
          className="p-3 sm:p-4 cursor-pointer hover:bg-muted/30 transition-colors"
          onClick={onToggle}
        >
          {/* Header row */}
          <div className="flex items-start sm:items-center justify-between mb-3 gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {/* Coin + Direction */}
              <div className="flex items-center gap-2">
                <span className="text-lg sm:text-xl font-bold">{signal.coin}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                  isLong ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
                }`}>
                  {signal.direction.toUpperCase()}
                </span>
              </div>
              
              {/* Funding context */}
              {signal.funding_context === 'favorable' && (
                <span className="text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-500 flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  <span className="hidden sm:inline">Funding pays you</span>
                  <span className="sm:hidden">Favorable</span>
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span className="hidden sm:inline">{formatTimeAgo(signal.updated_at || signal.created_at)}</span>
                <span className="sm:hidden">{formatTimeAgo(signal.updated_at || signal.created_at).replace(' ago', '')}</span>
              </span>
              {isExpanded ? (
                <ChevronUp className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
          </div>
          
          {/* Story */}
          <SignalStory signal={signal} />
          
          {/* Price + Stop */}
          <div className="mt-3 sm:mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <PriceDisplay signal={signal} />
            <div className="text-sm">
              <span className="text-muted-foreground">Stop: </span>
              <span className="text-red-500 font-mono">
                {formatPrice(signal.stop_loss)} 
                <span className="text-xs ml-1">(-{stopPct.toFixed(1)}%)</span>
              </span>
            </div>
          </div>
        </div>
        
        {/* Expanded View */}
        {isExpanded && (
          <div className="border-t border-border bg-muted/20 p-3 sm:p-4 space-y-4">
            {/* Copy Trade Button */}
            <div className="flex justify-end">
              <CopyTradeButton signal={signal} />
            </div>
            
            {/* Take Profit Levels */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4 text-sm">
              <div className="bg-background rounded-lg p-2 sm:p-3 text-center">
                <div className="text-green-400 text-xs mb-1">TP1 (1:1)</div>
                <div className="font-mono font-medium text-green-400 text-xs sm:text-sm">{formatPrice(signal.take_profit_1)}</div>
              </div>
              <div className="bg-background rounded-lg p-2 sm:p-3 text-center">
                <div className="text-green-500 text-xs mb-1">TP2 (2:1)</div>
                <div className="font-mono font-medium text-green-500 text-xs sm:text-sm">{formatPrice(signal.take_profit_2)}</div>
              </div>
              <div className="bg-background rounded-lg p-2 sm:p-3 text-center">
                <div className="text-green-600 text-xs mb-1">TP3 (3:1)</div>
                <div className="font-mono font-medium text-green-600 text-xs sm:text-sm">{formatPrice(signal.take_profit_3)}</div>
              </div>
            </div>
            
            {/* Signal Stats */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4 text-sm">
              <div>
                <div className="text-muted-foreground text-xs">Combined 7d P&L</div>
                <div className={`font-medium ${(signal.combined_pnl_7d || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatPnl(signal.combined_pnl_7d || 0)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Avg Win Rate</div>
                <div className="font-medium">{((signal.avg_win_rate || 0) * 100).toFixed(0)}%</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Avg Conviction</div>
                <div className="font-medium">{(signal.avg_conviction_pct || 0).toFixed(0)}%</div>
              </div>
            </div>
            
            {/* Traders List */}
            {traders.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-2">Traders in this signal</div>
                <div className="space-y-2">
                  {traders.map((trader) => (
                    <a
                      key={trader.address}
                      href={getTraderUrl(trader.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-2 bg-background rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          trader.tier === 'elite' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500'
                        }`}>
                          {trader.tier === 'elite' ? 'Elite' : 'Good'}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {trader.address.slice(0, 6)}...{trader.address.slice(-4)}
                        </span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </div>
                      <div className="flex items-center gap-2 sm:gap-4 text-xs">
                        <span className={(trader.pnl_7d || 0) >= 0 ? 'text-green-500' : 'text-red-500'}>
                          {formatPnl(trader.pnl_7d || 0)}
                        </span>
                        <span className="text-muted-foreground hidden sm:inline">
                          {((trader.win_rate || 0) * 100).toFixed(0)}% WR
                        </span>
                        {trader.conviction_pct && trader.conviction_pct > 0 && (
                          <span className="text-muted-foreground hidden sm:inline">
                            {trader.conviction_pct.toFixed(0)}% conv
                          </span>
                        )}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================
// MAIN PAGE
// ============================================

export default function SignalsPage() {
  const [signals, setSignals] = useState<QualitySignal[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [signalStats, setSignalStats] = useState<SignalStats | null>(null);
  const [filter, setFilter] = useState<'all' | 'strong' | 'long' | 'short'>('all');
  const [expandedSignal, setExpandedSignal] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>('');
  const [mounted, setMounted] = useState(false);

  const supabase = createClient();

  const fetchSignals = useCallback(async () => {
    setIsLoading(true);
    
    const { data, error } = await supabase
      .from('quality_signals')
      .select('*')
      .eq('is_active', true)
      .order('signal_strength', { ascending: false })
      .order('confidence', { ascending: false });

    if (data && !error) {
      setSignals(data);
    }
    
    setIsLoading(false);
    setLastRefresh(new Date().toLocaleTimeString());
  }, [supabase]);

  const fetchStats = useCallback(async () => {
    const { data } = await supabase
      .from('trader_quality')
      .select('quality_tier')
      .eq('is_tracked', true);

    if (data) {
      const elite = data.filter(t => t.quality_tier === 'elite').length;
      const good = data.filter(t => t.quality_tier === 'good').length;
      setStats({
        elite_count: elite,
        good_count: good,
        tracked_count: data.length
      });
    }
  }, [supabase]);

  const fetchSignalStats = useCallback(async () => {
    const { data } = await supabase
      .from('quality_signals')
      .select('outcome')
      .not('outcome', 'is', null);

    if (data) {
      const total = data.length;
      const wins = data.filter(s => ['tp1', 'tp2', 'tp3'].includes(s.outcome)).length;
      const stopped = data.filter(s => s.outcome === 'stopped').length;
      const open = data.filter(s => s.outcome === 'open').length;
      const closed = total - open;
      
      setSignalStats({
        total,
        wins,
        stopped,
        open,
        win_rate: closed > 0 ? (wins / closed) * 100 : 0
      });
    }
  }, [supabase]);

  useEffect(() => {
    setMounted(true);
    fetchSignals();
    fetchStats();
    fetchSignalStats();

    const interval = setInterval(fetchSignals, 30000);
    return () => clearInterval(interval);
  }, [fetchSignals, fetchStats, fetchSignalStats]);

  const handleRefresh = () => {
    fetchSignals();
    fetchStats();
    fetchSignalStats();
  };

  const filteredSignals = signals.filter((s) => {
    if (filter === 'all') return true;
    if (filter === 'strong') return s.signal_strength === 'strong';
    if (filter === 'long') return s.direction === 'long';
    if (filter === 'short') return s.direction === 'short';
    return true;
  });

  if (!mounted) {
    return (
      <div className="min-h-screen bg-background font-sans">
        <header className="border-b border-border">
          <div className="max-w-3xl mx-auto px-4 py-4">
            <h1 className="text-xl font-semibold">Quality Signals</h1>
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Header */}
      <header className="border-b border-border sticky top-0 bg-background z-20">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg sm:text-xl font-semibold">Quality Signals</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Following {stats?.tracked_count || 0} traders
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              {stats && (
                <div className="text-xs sm:text-sm">
                  <span className="text-green-500 font-medium">{stats.elite_count} Elite</span>
                  <span className="text-muted-foreground mx-1">·</span>
                  <span className="text-blue-500 font-medium">{stats.good_count} Good</span>
                </div>
              )}
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm bg-secondary hover:bg-secondary/80 rounded-md transition-colors disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {/* Signal Performance Summary */}
        <SignalPerformanceSummary stats={signalStats} />
        
        {/* Filters */}
        <div className="flex gap-2 mb-4 sm:mb-6 overflow-x-auto pb-1">
          {(['all', 'strong', 'long', 'short'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs sm:text-sm rounded-md transition-colors whitespace-nowrap ${
                filter === f 
                  ? f === 'long' ? 'bg-green-600 text-white'
                  : f === 'short' ? 'bg-red-600 text-white'
                  : f === 'strong' ? 'bg-yellow-600 text-white'
                  : 'bg-primary text-primary-foreground'
                  : 'bg-secondary hover:bg-secondary/80'
              }`}
            >
              {f === 'all' ? 'All' : f === 'strong' ? 'Strong' : f.charAt(0).toUpperCase() + f.slice(1) + 's'}
            </button>
          ))}
        </div>

        {/* Signals */}
        {filteredSignals.length > 0 ? (
          <div className="space-y-3 sm:space-y-4">
            {filteredSignals.map((signal) => (
              <SignalCard 
                key={signal.id} 
                signal={signal}
                isExpanded={expandedSignal === signal.id}
                onToggle={() => setExpandedSignal(
                  expandedSignal === signal.id ? null : signal.id
                )}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <h3 className="text-lg font-medium mb-2">No Active Signals</h3>
              <p className="text-muted-foreground text-sm">
                Signals appear when multiple quality traders converge on the same position.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="flex items-center justify-center gap-2 mt-6 text-xs sm:text-sm text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span>Live · Updated {lastRefresh}</span>
        </div>
      </main>
    </div>
  );
}