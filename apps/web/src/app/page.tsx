'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  ChevronDown, 
  ChevronRight, 
  LogIn, 
  LogOut, 
  Copy, 
  Check,
  TrendingUp,
  TrendingDown,
  Clock,
  Target,
  ShieldAlert,
  Zap,
  BarChart3,
  Info
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
  strategy_type?: string;
  position_age_hours?: number;
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
  avg_entry_price: number;
  signal_strength: string;
  confidence: number;
  suggested_entry: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  take_profit_3: number;
  funding_context: string;
  avg_conviction_pct: number;
  entry_price: number;
  current_price: number;
  current_pnl_pct: number;
  max_pnl_pct: number;
  min_pnl_pct: number;
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
  entry_price: number | null;
  exit_price: number | null;
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

interface PriceData {
  [coin: string]: {
    price: number;
    change24h: number;
    sparkline: number[];
  };
}

interface SignalPerformance {
  total_signals: number;
  win_rate: number;
  avg_pnl: number;
  stopped: number;
  tp_hit: number;
}

// ============================================
// SPARKLINE COMPONENT
// ============================================

function Sparkline({ data, width = 60, height = 24, color = '#22c55e' }: { 
  data: number[]; 
  width?: number; 
  height?: number;
  color?: string;
}) {
  if (!data || data.length < 2) return null;
  
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');
  
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ============================================
// COPY BUTTON COMPONENT
// ============================================

function CopyButton({ value, label }: { value: string | number; label: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(String(value));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      title={`Copy ${label}`}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}

// ============================================
// PRICE DISPLAY WITH ENTRY COMPARISON
// ============================================

function PriceComparison({ 
  currentPrice, 
  entryPrice, 
  direction 
}: { 
  currentPrice: number; 
  entryPrice: number;
  direction: string;
}) {
  const priceDiff = ((currentPrice - entryPrice) / entryPrice) * 100;
  const isLong = direction === 'long';
  const isFavorable = isLong ? priceDiff < 0 : priceDiff > 0;
  
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono font-medium">
        ${currentPrice.toLocaleString(undefined, { maximumFractionDigits: currentPrice < 1 ? 4 : 2 })}
      </span>
      <span className={`text-xs px-1.5 py-0.5 rounded ${
        isFavorable 
          ? 'bg-green-500/20 text-green-500' 
          : 'bg-red-500/20 text-red-500'
      }`}>
        {priceDiff >= 0 ? '+' : ''}{priceDiff.toFixed(2)}%
      </span>
      {isFavorable && (
        <span className="text-xs text-green-500">
          {isLong ? '↓ Good entry' : '↑ Good entry'}
        </span>
      )}
    </div>
  );
}

// ============================================
// SIGNAL P&L DISPLAY
// ============================================

function SignalPnL({ 
  currentPnl, 
  maxPnl, 
  minPnl,
  direction
}: { 
  currentPnl: number;
  maxPnl: number;
  minPnl: number;
  direction: string;
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">Now:</span>
        <span className={`font-medium ${currentPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          {currentPnl >= 0 ? '+' : ''}{currentPnl.toFixed(2)}%
        </span>
      </div>
      <div className="flex items-center gap-1">
        <TrendingUp className="h-3 w-3 text-green-500" />
        <span className="text-green-500">+{maxPnl.toFixed(2)}%</span>
      </div>
      <div className="flex items-center gap-1">
        <TrendingDown className="h-3 w-3 text-red-500" />
        <span className="text-red-500">{minPnl.toFixed(2)}%</span>
      </div>
    </div>
  );
}

// ============================================
// STOP/TP LEVELS DISPLAY
// ============================================

function TradeLevels({ 
  entry, 
  stop, 
  tp1, 
  tp2, 
  tp3,
  currentPrice,
  direction
}: { 
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  currentPrice: number;
  direction: string;
}) {
  const formatPrice = (p: number) => {
    if (!p) return '-';
    if (p >= 1000) return '$' + p.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (p >= 1) return '$' + p.toFixed(2);
    return '$' + p.toFixed(4);
  };
  
  const getStopDistance = () => {
    if (!stop || !entry) return null;
    return Math.abs((stop - entry) / entry * 100).toFixed(1);
  };
  
  const isLong = direction === 'long';
  
  return (
    <div className="grid grid-cols-5 gap-2 text-xs bg-muted/30 rounded-lg p-3">
      <div className="text-center">
        <div className="text-muted-foreground mb-1">Entry</div>
        <div className="font-mono font-medium flex items-center justify-center gap-1">
          {formatPrice(entry)}
          <CopyButton value={entry} label="entry price" />
        </div>
      </div>
      <div className="text-center">
        <div className="text-red-400 mb-1 flex items-center justify-center gap-1">
          <ShieldAlert className="h-3 w-3" />
          Stop
        </div>
        <div className="font-mono font-medium text-red-400 flex items-center justify-center gap-1">
          {formatPrice(stop)}
          <CopyButton value={stop} label="stop loss" />
        </div>
        {getStopDistance() && (
          <div className="text-red-400/70 text-[10px]">-{getStopDistance()}%</div>
        )}
      </div>
      <div className="text-center">
        <div className="text-green-400 mb-1 flex items-center justify-center gap-1">
          <Target className="h-3 w-3" />
          TP1
        </div>
        <div className="font-mono font-medium text-green-400 flex items-center justify-center gap-1">
          {formatPrice(tp1)}
          <CopyButton value={tp1} label="TP1" />
        </div>
      </div>
      <div className="text-center">
        <div className="text-green-500 mb-1">TP2</div>
        <div className="font-mono font-medium text-green-500 flex items-center justify-center gap-1">
          {formatPrice(tp2)}
          <CopyButton value={tp2} label="TP2" />
        </div>
      </div>
      <div className="text-center">
        <div className="text-green-600 mb-1">TP3</div>
        <div className="font-mono font-medium text-green-600 flex items-center justify-center gap-1">
          {formatPrice(tp3)}
          <CopyButton value={tp3} label="TP3" />
        </div>
      </div>
    </div>
  );
}

// ============================================
// FUNDING CONTEXT BADGE
// ============================================

function FundingBadge({ context }: { context: string }) {
  if (!context || context === 'neutral') return null;
  
  const isFavorable = context === 'favorable';
  
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${
      isFavorable 
        ? 'bg-green-500/20 text-green-500' 
        : 'bg-yellow-500/20 text-yellow-500'
    }`}>
      <Zap className="h-3 w-3" />
      Funding {isFavorable ? 'pays you' : 'costs you'}
    </span>
  );
}

// ============================================
// CONFIDENCE METER
// ============================================

function ConfidenceMeter({ score }: { score: number }) {
  const getColor = () => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };
  
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className={`h-full ${getColor()} transition-all`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-xs font-medium">{score}%</span>
    </div>
  );
}

// ============================================
// POSITION AGE DISPLAY
// ============================================

function PositionAge({ hours }: { hours: number }) {
  const formatAge = (h: number) => {
    if (h < 1) return `${Math.round(h * 60)}m`;
    if (h < 24) return `${Math.round(h)}h`;
    if (h < 168) return `${Math.round(h / 24)}d`;
    return `${Math.round(h / 168)}w`;
  };
  
  const getFreshness = () => {
    if (hours < 2) return { label: 'Very Fresh', color: 'text-green-500 bg-green-500/20' };
    if (hours < 24) return { label: 'Fresh', color: 'text-blue-500 bg-blue-500/20' };
    if (hours < 168) return { label: 'Established', color: 'text-yellow-500 bg-yellow-500/20' };
    return { label: 'Long-held', color: 'text-muted-foreground bg-muted' };
  };
  
  const freshness = getFreshness();
  
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${freshness.color}`}>
      <Clock className="h-3 w-3" />
      {formatAge(hours)} ({freshness.label})
    </span>
  );
}

// ============================================
// TRADER IDENTITY (readable names)
// ============================================

function TraderIdentity({ address, tier, strategy }: { address: string; tier: string; strategy?: string }) {
  // Generate a memorable identifier from the address
  const getTraderAlias = (addr: string) => {
    const adjectives = ['Swift', 'Bold', 'Calm', 'Sharp', 'Wise', 'Quick', 'Deep', 'Keen'];
    const animals = ['Wolf', 'Hawk', 'Bear', 'Fox', 'Lion', 'Eagle', 'Tiger', 'Shark'];
    
    // Use address characters to deterministically select words
    const adj = adjectives[parseInt(addr.slice(2, 4), 16) % adjectives.length];
    const animal = animals[parseInt(addr.slice(4, 6), 16) % animals.length];
    const num = parseInt(addr.slice(-2), 16) % 100;
    
    return `${adj}${animal}${num}`;
  };
  
  const alias = getTraderAlias(address);
  const strategyEmoji = {
    'momentum': '🚀',
    'mean_reversion': '🔄',
    'scalper': '⚡',
    'swing': '🌊',
    'position': '🏔️',
    'unknown': '❓'
  }[strategy || 'unknown'] || '❓';
  
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
        tier === 'elite' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500'
      }`}>
        {tier === 'elite' ? 'E' : 'G'}
      </span>
      <span className="font-medium text-sm">{alias}</span>
      {strategy && strategy !== 'unknown' && (
        <span title={strategy} className="text-sm">{strategyEmoji}</span>
      )}
      <span className="font-mono text-xs text-muted-foreground">
        ({address.slice(2, 6)}...{address.slice(-4)})
      </span>
    </div>
  );
}

// ============================================
// HISTORICAL PERFORMANCE CARD
// ============================================

function HistoricalPerformance({ performance }: { performance: SignalPerformance | null }) {
  if (!performance) return null;
  
  return (
    <div className="flex items-center gap-4 text-xs bg-muted/30 rounded-lg px-3 py-2">
      <div className="flex items-center gap-1">
        <BarChart3 className="h-3 w-3 text-muted-foreground" />
        <span className="text-muted-foreground">Past signals:</span>
      </div>
      <div>
        <span className="font-medium">{performance.total_signals}</span>
        <span className="text-muted-foreground"> total</span>
      </div>
      <div>
        <span className={`font-medium ${performance.win_rate >= 50 ? 'text-green-500' : 'text-red-500'}`}>
          {performance.win_rate.toFixed(0)}%
        </span>
        <span className="text-muted-foreground"> win rate</span>
      </div>
      <div>
        <span className={`font-medium ${performance.avg_pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          {performance.avg_pnl >= 0 ? '+' : ''}{performance.avg_pnl.toFixed(1)}%
        </span>
        <span className="text-muted-foreground"> avg</span>
      </div>
    </div>
  );
}

// ============================================
// MAIN PAGE COMPONENT
// ============================================

export default function SignalsPage() {
  const [signals, setSignals] = useState<QualitySignal[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedSignal, setExpandedSignal] = useState<number | null>(null);
  const [expandedNewTrades, setExpandedNewTrades] = useState<number | null>(null);
  const [expandedClosedTrades, setExpandedClosedTrades] = useState<number | null>(null);
  const [signalHistory, setSignalHistory] = useState<Record<string, SignalHistory>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});
  const [lastRefresh, setLastRefresh] = useState<string>('--:--:--');
  const [filter, setFilter] = useState<string>('all');
  const [mounted, setMounted] = useState(false);
  const [prices, setPrices] = useState<PriceData>({});
  const [historicalPerformance, setHistoricalPerformance] = useState<SignalPerformance | null>(null);

  // Handle hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Format date/time in EST
  function formatDateTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' EST';
  }

  // Format timestamp with actual time
  function formatTimestamp(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    const timeStr = date.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    
    if (diffMins < 1) return `Just now (${timeStr})`;
    if (diffMins < 60) return `${diffMins}m ago (${timeStr})`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago (${timeStr})`;
    
    return formatDateTime(dateString);
  }

  // Fetch live prices from Hyperliquid
  async function fetchPrices(coins: string[]) {
    try {
      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'allMids' }),
      });
      
      if (response.ok) {
        const data = await response.json();
        const newPrices: PriceData = {};
        
        for (const coin of coins) {
          if (data[coin]) {
            newPrices[coin] = {
              price: parseFloat(data[coin]),
              change24h: 0, // Would need separate call for 24h change
              sparkline: [], // Would need candle data
            };
          }
        }
        
        setPrices(newPrices);
      }
    } catch (error) {
      console.error('Failed to fetch prices:', error);
    }
  }

  // Fetch historical signal performance
  async function fetchHistoricalPerformance() {
    const supabase = createClient();
    
    const { data, error } = await supabase
      .from('quality_signals')
      .select('outcome, final_pnl_pct')
      .not('outcome', 'is', null)
      .neq('outcome', 'open');
    
    if (!error && data && data.length > 0) {
      const completed = data.filter(s => s.outcome !== 'open');
      const wins = completed.filter(s => 
        ['tp1', 'tp2', 'tp3'].includes(s.outcome) || 
        (s.final_pnl_pct && s.final_pnl_pct > 0)
      );
      
      const avgPnl = completed.reduce((sum, s) => sum + (s.final_pnl_pct || 0), 0) / completed.length;
      
      setHistoricalPerformance({
        total_signals: completed.length,
        win_rate: (wins.length / completed.length) * 100,
        avg_pnl: avgPnl,
        stopped: completed.filter(s => s.outcome === 'stopped').length,
        tp_hit: wins.length,
      });
    }
  }

  // Fetch ALL history for a specific signal
  const fetchHistory = useCallback(async (coin: string, direction: string) => {
    const key = `${coin}-${direction}`;
    
    setHistoryLoading(prev => ({ ...prev, [key]: true }));
    
    const supabase = createClient();
    
    try {
      const { data, error } = await supabase
        .from('signal_position_history')
        .select('*')
        .eq('coin', coin)
        .eq('direction', direction)
        .order('created_at', { ascending: false })
        .limit(100);
      
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
      console.log('History table not available yet');
    }
    
    setHistoryLoading(prev => ({ ...prev, [key]: false }));
  }, []);

  async function fetchData() {
    const supabase = createClient();
    
    // Fetch signals with all new fields
    const signalsResult = await supabase
      .from('quality_signals')
      .select(`
        id, coin, direction, elite_count, good_count, total_traders, traders,
        combined_pnl_7d, avg_win_rate, total_position_value, avg_entry_price,
        signal_strength, confidence, suggested_entry, stop_loss,
        take_profit_1, take_profit_2, take_profit_3, funding_context,
        avg_conviction_pct, entry_price, current_price, current_pnl_pct,
        max_pnl_pct, min_pnl_pct, created_at, updated_at, is_active
      `)
      .eq('is_active', true)
      .order('elite_count', { ascending: false })
      .order('total_traders', { ascending: false });
    
    if (!signalsResult.error && signalsResult.data) {
      setSignals(signalsResult.data);
      
      // Fetch live prices for all signal coins
      const coins = [...new Set(signalsResult.data.map(s => s.coin))];
      fetchPrices(coins);
    }
    
    // Fetch stats
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
    
    // Fetch historical performance
    fetchHistoricalPerformance();
    
    setIsLoading(false);
    setLastRefresh(new Date().toLocaleTimeString());
  }

  useEffect(() => {
    if (mounted) {
      fetchData();
      const interval = setInterval(fetchData, 30 * 1000);
      
      // Faster price updates
      const priceInterval = setInterval(() => {
        const coins = signals.map(s => s.coin);
        if (coins.length > 0) fetchPrices(coins);
      }, 10 * 1000);
      
      return () => {
        clearInterval(interval);
        clearInterval(priceInterval);
      };
    }
  }, [mounted]);

  function handleRefresh() {
    setIsLoading(true);
    setSignalHistory({});
    fetchData();
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

  function formatPrice(value: number | null): string {
    if (!value) return '';
    if (value >= 1000) return '$' + value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (value >= 1) return '$' + value.toFixed(2);
    return '$' + value.toFixed(4);
  }

  function getTraderUrl(wallet: string): string {
    return 'https://legacy.hyperdash.com/trader/' + wallet;
  }

  function toggleNewTrades(signalId: number, coin: string, direction: string) {
    if (expandedNewTrades === signalId) {
      setExpandedNewTrades(null);
    } else {
      setExpandedNewTrades(signalId);
      setExpandedClosedTrades(null);
      const key = `${coin}-${direction}`;
      if (!signalHistory[key]) {
        fetchHistory(coin, direction);
      }
    }
  }

  function toggleClosedTrades(signalId: number, coin: string, direction: string) {
    if (expandedClosedTrades === signalId) {
      setExpandedClosedTrades(null);
    } else {
      setExpandedClosedTrades(signalId);
      setExpandedNewTrades(null);
      const key = `${coin}-${direction}`;
      if (!signalHistory[key]) {
        fetchHistory(coin, direction);
      }
    }
  }

  const filteredSignals = signals.filter((s) => {
    if (filter === 'all') return true;
    if (filter === 'strong') return s.signal_strength === 'strong';
    if (filter === 'long') return s.direction === 'long';
    if (filter === 'short') return s.direction === 'short';
    return true;
  });

  // Loading state
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
        {/* Historical Performance Summary */}
        {historicalPerformance && historicalPerformance.total_signals > 0 && (
          <div className="mb-6">
            <HistoricalPerformance performance={historicalPerformance} />
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setFilter('all')}
            className={'px-3 py-1.5 text-sm rounded-md transition-colors ' + 
              (filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-secondary/80')}
          >
            All
          </button>
          <button
            onClick={() => setFilter('strong')}
            className={'px-3 py-1.5 text-sm rounded-md transition-colors ' + 
              (filter === 'strong' ? 'bg-yellow-600 text-white' : 'bg-secondary hover:bg-secondary/80')}
          >
            Strong Only
          </button>
          <button
            onClick={() => setFilter('long')}
            className={'px-3 py-1.5 text-sm rounded-md transition-colors ' + 
              (filter === 'long' ? 'bg-green-600 text-white' : 'bg-secondary hover:bg-secondary/80')}
          >
            Longs
          </button>
          <button
            onClick={() => setFilter('short')}
            className={'px-3 py-1.5 text-sm rounded-md transition-colors ' + 
              (filter === 'short' ? 'bg-red-600 text-white' : 'bg-secondary hover:bg-secondary/80')}
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
              const isHistoryLoading = historyLoading[historyKey] || false;
              const isNewTradesOpen = expandedNewTrades === signal.id;
              const isClosedTradesOpen = expandedClosedTrades === signal.id;
              
              // Use live price if available, otherwise use stored current_price
              const currentPrice = prices[signal.coin]?.price || signal.current_price || signal.avg_entry_price;
              const entryPrice = signal.entry_price || signal.suggested_entry || signal.avg_entry_price;
              
              // Calculate average position age from traders
              const avgPositionAge = traders.length > 0
                ? traders.reduce((sum, t) => sum + (t.position_age_hours || 0), 0) / traders.length
                : null;
              
              return (
                <Card key={signal.id} className="overflow-hidden">
                  <CardContent className="p-0">
                    <div className="flex">
                      {/* Left - Coin/Direction */}
                      <div className={'w-28 flex flex-col items-center justify-center p-4 ' + 
                        (signal.direction === 'long' ? 'bg-green-500/10' : 'bg-red-500/10')}>
                        <span className="text-2xl font-bold">{signal.coin}</span>
                        <span className={'text-xs font-medium px-2 py-0.5 rounded mt-1 ' + 
                          (signal.direction === 'long' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500')}>
                          {signal.direction.toUpperCase()}
                        </span>
                        
                        {/* Confidence Meter */}
                        <div className="mt-3">
                          <ConfidenceMeter score={signal.confidence || 50} />
                        </div>
                      </div>

                      {/* Right - Details */}
                      <div className="flex-1 p-4">
                        {/* Top row - Traders, Strength, Timestamp */}
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
                              {(signal.signal_strength || 'medium').toUpperCase()}
                            </Badge>
                            <FundingBadge context={signal.funding_context} />
                            {avgPositionAge !== null && avgPositionAge > 0 && (
                              <PositionAge hours={avgPositionAge} />
                            )}
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {formatTimestamp(signal.updated_at || signal.created_at)}
                          </span>
                        </div>

                        {/* Current Price vs Entry */}
                        {currentPrice && entryPrice && (
                          <div className="mb-3">
                            <div className="text-xs text-muted-foreground mb-1">Current Price</div>
                            <PriceComparison 
                              currentPrice={currentPrice} 
                              entryPrice={entryPrice} 
                              direction={signal.direction} 
                            />
                          </div>
                        )}

                        {/* Signal P&L */}
                        {(signal.current_pnl_pct !== null || signal.max_pnl_pct || signal.min_pnl_pct) && (
                          <div className="mb-3">
                            <div className="text-xs text-muted-foreground mb-1">Signal Performance</div>
                            <SignalPnL 
                              currentPnl={signal.current_pnl_pct || 0}
                              maxPnl={signal.max_pnl_pct || 0}
                              minPnl={signal.min_pnl_pct || 0}
                              direction={signal.direction}
                            />
                          </div>
                        )}

                        {/* Stop Loss / Take Profit Levels */}
                        <div className="mb-3">
                          <TradeLevels
                            entry={entryPrice}
                            stop={signal.stop_loss}
                            tp1={signal.take_profit_1}
                            tp2={signal.take_profit_2}
                            tp3={signal.take_profit_3}
                            currentPrice={currentPrice}
                            direction={signal.direction}
                          />
                        </div>

                        {/* Stats row */}
                        <div className="grid grid-cols-4 gap-4 text-sm mb-3 bg-muted/20 rounded-lg p-3">
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
                            <div className="text-muted-foreground text-xs">Avg Conviction</div>
                            <div className="font-medium">
                              {(signal.avg_conviction_pct || 0).toFixed(1)}%
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
                                <div key={trader.address} className="flex items-center justify-between text-sm py-2 border-b border-border last:border-0">
                                  <a
                                    href={getTraderUrl(trader.address)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:opacity-80 transition-opacity"
                                  >
                                    <TraderIdentity 
                                      address={trader.address} 
                                      tier={trader.tier || 'good'} 
                                      strategy={trader.strategy_type}
                                    />
                                  </a>
                                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                    <span className={(trader.pnl_7d || 0) >= 0 ? 'text-green-500' : 'text-red-500'}>
                                      7d: {formatPnl(trader.pnl_7d || 0)}
                                    </span>
                                    <span>WR: {((trader.win_rate || 0) * 100).toFixed(0)}%</span>
                                    <span>Pos: {formatValue(trader.position_value || 0)}</span>
                                    {trader.conviction_pct && (
                                      <span>Conv: {trader.conviction_pct.toFixed(1)}%</span>
                                    )}
                                    {trader.position_age_hours && (
                                      <span className="text-blue-400">
                                        Age: {trader.position_age_hours < 24 
                                          ? `${Math.round(trader.position_age_hours)}h` 
                                          : `${Math.round(trader.position_age_hours / 24)}d`}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : traders.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {traders.slice(0, 3).map((trader) => (
                                <a
                                  key={trader.address}
                                  href={getTraderUrl(trader.address)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-xs hover:opacity-80"
                                >
                                  <TraderIdentity 
                                    address={trader.address} 
                                    tier={trader.tier || 'good'} 
                                    strategy={trader.strategy_type}
                                  />
                                  <span className={(trader.pnl_7d || 0) >= 0 ? 'text-green-500' : 'text-red-500'}>
                                    {formatPnl(trader.pnl_7d || 0)}
                                  </span>
                                </a>
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
                            {signalHistory[historyKey] && (
                              <span className="text-xs text-muted-foreground">
                                ({history.opened.length})
                              </span>
                            )}
                          </button>
                          
                          {isNewTradesOpen && (
                            <div className="mt-2 pl-6">
                              {isHistoryLoading ? (
                                <div className="text-xs text-muted-foreground py-2">Loading...</div>
                              ) : history.opened.length === 0 ? (
                                <div className="text-xs text-muted-foreground py-2">
                                  No entries recorded yet
                                </div>
                              ) : (
                                <div className="space-y-1 max-h-64 overflow-y-auto">
                                  {history.opened.map((event) => (
                                    <div key={event.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0">
                                      <div className="flex items-center gap-2">
                                        <TraderIdentity 
                                          address={event.address} 
                                          tier={event.quality_tier} 
                                        />
                                        {event.position_value > 0 && (
                                          <span className="text-muted-foreground">
                                            {formatValue(event.position_value)}
                                          </span>
                                        )}
                                        {event.entry_price && (
                                          <span className="text-muted-foreground">
                                            @ {formatPrice(event.entry_price)}
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-muted-foreground whitespace-nowrap">
                                        {formatDateTime(event.created_at)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
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
                            {signalHistory[historyKey] && (
                              <span className="text-xs text-muted-foreground">
                                ({history.closed.length})
                              </span>
                            )}
                          </button>
                          
                          {isClosedTradesOpen && (
                            <div className="mt-2 pl-6">
                              {isHistoryLoading ? (
                                <div className="text-xs text-muted-foreground py-2">Loading...</div>
                              ) : history.closed.length === 0 ? (
                                <div className="text-xs text-muted-foreground py-2">
                                  No exits recorded yet
                                </div>
                              ) : (
                                <div className="space-y-1 max-h-64 overflow-y-auto">
                                  {history.closed.map((event) => (
                                    <div key={event.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0">
                                      <div className="flex items-center gap-2">
                                        <TraderIdentity 
                                          address={event.address} 
                                          tier={event.quality_tier} 
                                        />
                                        {event.pnl_realized !== null && (
                                          <span className={event.pnl_realized >= 0 ? 'text-green-500 font-medium' : 'text-red-500 font-medium'}>
                                            {event.pnl_realized >= 0 ? '+' : ''}{formatPnl(event.pnl_realized)}
                                          </span>
                                        )}
                                        {event.exit_price && (
                                          <span className="text-muted-foreground">
                                            @ {formatPrice(event.exit_price)}
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-muted-foreground whitespace-nowrap">
                                        {formatDateTime(event.created_at)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
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