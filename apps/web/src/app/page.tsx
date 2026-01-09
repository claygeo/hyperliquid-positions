'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { 
  ChevronDown, 
  ChevronUp, 
  Zap,
  Clock,
  ExternalLink,
  Plus,
  X,
  Loader2,
  Timer,
  BarChart3
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
  opened_at?: string | null;
  unrealized_pnl?: number;
  unrealized_pnl_pct?: number;
  exit_price?: number | null;
  exited_at?: string | null;
  exit_type?: 'manual' | 'stopped' | 'liquidated' | 'signal_closed' | null;
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
  signal_tier: 'elite_entry' | 'confirmed' | 'consensus' | null;
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
  closed_at?: string;
  outcome?: string;
  final_pnl_pct?: number;
  hit_stop?: boolean;
  hit_tp1?: boolean;
  hit_tp2?: boolean;
  hit_tp3?: boolean;
  invalidation_reason?: string;
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

interface ImportProgress {
  current: number;
  total: number;
  currentAddress: string;
  status: 'inserting' | 'analyzing' | 'done' | 'error';
  results: {
    address: string;
    tier: string;
    pnl_7d: number;
    status: 'success' | 'error';
    error?: string;
  }[];
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

function formatDateEST(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York'
  });
}

function formatDateTimeEST(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  
  const estDateTime = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York'
  });
  
  let ago: string;
  if (diffMins < 1) ago = 'just now';
  else if (diffMins < 60) ago = `${diffMins}m ago`;
  else if (diffHours < 24) ago = `${diffHours}h ago`;
  else ago = `${Math.floor(diffHours / 24)}d ago`;
  
  return `${estDateTime} EST · ${ago}`;
}

function formatDuration(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end.getTime() - start.getTime();
  
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  
  return `${minutes}m`;
}

function formatTraderEntry(entryPrice: number, currentPrice: number, direction: string): { pnlPct: number; display: string } {
  let pnlPct: number;
  if (direction === 'long') {
    pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
  } else {
    pnlPct = ((entryPrice - currentPrice) / entryPrice) * 100;
  }
  
  const sign = pnlPct >= 0 ? '+' : '';
  return {
    pnlPct,
    display: `${sign}${pnlPct.toFixed(1)}%`
  };
}

function getTraderUrl(address: string): string {
  return `https://hyperdash.info/trader/${address}`;
}

function parseAddresses(input: string): string[] {
  const addresses = input
    .split(/[\s,\n]+/)
    .map(addr => addr.trim().toLowerCase())
    .filter(addr => addr.startsWith('0x') && addr.length === 42);
  
  return [...new Set(addresses)];
}

function formatInvalidationReason(reason: string | undefined): string {
  if (!reason) return 'Closed';
  
  const reasonMap: Record<string, string> = {
    'all_traders_exited': 'All traders exited',
    'majority_exit_100pct': 'All traders exited',
    'below_minimum_traders': 'Too few traders',
    'traders_no_longer_qualify': 'Traders disqualified',
    'trader_flipped_direction': 'Trader flipped',
    'replaced_by_short_signal': 'Replaced by SHORT',
    'replaced_by_long_signal': 'Replaced by LONG',
    'stale_signal': 'Expired',
    'system_reset_v10_migration': 'System migration',
    'system_reset': 'System reset',
    'manual_close': 'Manual close',
  };
  
  return reasonMap[reason] || reason.replace(/_/g, ' ');
}

function calculatePnlFromPrices(entryPrice: number, exitPrice: number, direction: string): number {
  if (!entryPrice || !exitPrice) return 0;
  
  if (direction === 'long') {
    return ((exitPrice - entryPrice) / entryPrice) * 100;
  } else {
    return ((entryPrice - exitPrice) / entryPrice) * 100;
  }
}

function getOutcomeDisplay(signal: QualitySignal): { label: string; color: string; sublabel?: string } {
  const calculatedPnl = calculatePnlFromPrices(
    signal.entry_price, 
    signal.current_price, 
    signal.direction
  );
  
  const pnl = (signal.entry_price && signal.current_price) ? calculatedPnl : (signal.final_pnl_pct || 0);
  const pnlDisplay = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`;
  const pnlColor = pnl >= 0 ? 'text-green-500' : 'text-red-500';
  
  if (signal.hit_tp3) return { label: pnlDisplay, color: 'text-green-500', sublabel: 'TP3 Hit' };
  if (signal.hit_tp2) return { label: pnlDisplay, color: 'text-green-500', sublabel: 'TP2 Hit' };
  if (signal.hit_tp1) return { label: pnlDisplay, color: 'text-green-400', sublabel: 'TP1 Hit' };
  
  if (signal.hit_stop || signal.outcome === 'stopped_out') {
    return { label: pnlDisplay, color: 'text-red-500', sublabel: 'Stopped' };
  }
  
  if (signal.invalidation_reason) {
    const reasonText = formatInvalidationReason(signal.invalidation_reason);
    return {
      label: pnlDisplay,
      color: pnlColor,
      sublabel: reasonText
    };
  }
  
  return { label: pnlDisplay, color: pnlColor };
}

function formatAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// ============================================
// SIGNAL BOTTOM SHEET
// ============================================

function SignalBottomSheet({
  signal,
  isOpen,
  onClose,
}: {
  signal: QualitySignal | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [startY, setStartY] = useState(0);
  const [currentY, setCurrentY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  if (!signal) return null;

  const traders = Array.isArray(signal.traders) ? signal.traders : [];
  const isLong = signal.direction === 'long';
  const stopPct = signal.stop_distance_pct || Math.abs((signal.stop_loss - signal.entry_price) / signal.entry_price * 100);
  
  const entry = signal.entry_price || signal.current_price;
  const current = signal.current_price;
  const pnlPct = signal.current_pnl_pct || calculatePnlFromPrices(entry, current, signal.direction);
  const isProfit = pnlPct >= 0;

  const openedDates = traders.map(t => t.opened_at).filter((d): d is string => d !== null && d !== undefined);
  const earliestEntry = openedDates.length > 0 
    ? openedDates.reduce((earliest, d) => new Date(d) < new Date(earliest) ? d : earliest)
    : signal.created_at;

  const handleTouchStart = (e: React.TouchEvent) => {
    setStartY(e.touches[0].clientY);
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    setCurrentY(e.touches[0].clientY);
  };

  const handleTouchEnd = () => {
    if (isDragging && currentY - startY > 100) {
      onClose();
    }
    setIsDragging(false);
    setStartY(0);
    setCurrentY(0);
  };

  const dragOffset = isDragging && currentY > startY ? currentY - startY : 0;

  return (
    <>
      {/* Overlay */}
      <div 
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      
      {/* Bottom Sheet */}
      <div 
        className={`fixed left-0 right-0 bottom-0 bg-card border-t border-border rounded-t-2xl z-50 transition-transform duration-300 ease-out max-h-[85vh] overflow-hidden flex flex-col ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ transform: isOpen ? `translateY(${dragOffset}px)` : 'translateY(100%)' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2 cursor-grab">
          <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
        </div>

        {/* Sheet Content - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Header */}
          <div className="px-4 pb-4 border-b border-border">
            {/* Title Row */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold">{signal.coin}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                  isLong ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
                }`}>
                  {signal.direction.toUpperCase()}
                </span>
                <span className="text-sm text-muted-foreground">
                  {signal.elite_count > 0 && <span className="text-green-500">{signal.elite_count}E</span>}
                  {signal.elite_count > 0 && signal.good_count > 0 && ' + '}
                  {signal.good_count > 0 && <span className="text-blue-500">{signal.good_count}G</span>}
                </span>
              </div>
              <span className={`text-xl font-bold font-mono ${isProfit ? 'text-green-500' : 'text-red-500'}`}>
                {isProfit ? '+' : ''}{pnlPct.toFixed(2)}%
              </span>
            </div>

            {/* Meta Grid */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-muted-foreground text-xs mb-0.5">Entry</div>
                <div className="font-mono">{formatPrice(entry)} → {formatPrice(current)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs mb-0.5">Opened</div>
                <div className="text-sm">{formatDateTimeEST(earliestEntry)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs mb-0.5">Stop Loss</div>
                <div className="text-red-500 font-mono">{formatPrice(signal.stop_loss)} (-{stopPct.toFixed(1)}%)</div>
              </div>
            </div>
          </div>

          {/* Take Profits */}
          <div className="grid grid-cols-3 gap-2 p-4 border-b border-border">
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">TP1 (1:1)</div>
              <div className="font-mono font-semibold text-green-500">{formatPrice(signal.take_profit_1)}</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">TP2 (2:1)</div>
              <div className="font-mono font-semibold text-green-500">{formatPrice(signal.take_profit_2)}</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">TP3 (3:1)</div>
              <div className="font-mono font-semibold text-green-500">{formatPrice(signal.take_profit_3)}</div>
            </div>
          </div>

          {/* Traders */}
          <div className="p-4">
            <div className="text-sm text-muted-foreground mb-3">Traders ({traders.length})</div>
            <div className="space-y-2">
              {traders.map((trader) => {
                const traderEntry = trader.entry_price || 0;
                const traderPnl = traderEntry && current 
                  ? formatTraderEntry(traderEntry, current, signal.direction)
                  : null;
                const entryTime = trader.opened_at ? formatDateEST(trader.opened_at) : null;
                
                return (
                  <a
                    key={trader.address}
                    href={getTraderUrl(trader.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-2.5 bg-muted/20 rounded-lg hover:bg-muted/40 transition-colors"
                  >
                    {/* Tier Badge */}
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0 ${
                      trader.tier === 'elite' 
                        ? 'bg-purple-500/20 text-purple-400' 
                        : 'bg-blue-500/20 text-blue-400'
                    }`}>
                      {trader.tier === 'elite' ? 'E' : 'G'}
                    </span>
                    
                    {/* Address */}
                    <span className="font-mono text-xs text-muted-foreground flex items-center gap-1 flex-shrink-0">
                      {formatAddress(trader.address)}
                      <ExternalLink className="h-3 w-3 opacity-50" />
                    </span>
                    
                    {/* Stats */}
                    <span className="text-[11px] text-muted-foreground flex-shrink-0">
                      {formatPnl(trader.pnl_7d || 0)} · {((trader.win_rate || 0) * 100).toFixed(0)}%
                    </span>
                    
                    {/* Right side - Entry & Time */}
                    <div className="ml-auto text-right flex-shrink-0">
                      <div className="text-sm font-mono">
                        {formatPrice(traderEntry)}
                        {traderPnl && (
                          <span className={`ml-1 text-xs ${traderPnl.pnlPct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {traderPnl.display}
                          </span>
                        )}
                      </div>
                      {entryTime && (
                        <div className="text-[11px] text-muted-foreground">{entryTime}</div>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
          </div>

          {/* Bottom safe area */}
          <div className="h-6" />
        </div>
      </div>
    </>
  );
}

// ============================================
// TRACK RECORD MODAL
// ============================================

function TrackRecordModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [closedSignals, setClosedSignals] = useState<QualitySignal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedSignal, setExpandedSignal] = useState<number | null>(null);
  const supabase = createClient();

  useEffect(() => {
    if (isOpen) {
      fetchClosedSignals();
    }
  }, [isOpen]);

  const fetchClosedSignals = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('quality_signals')
      .select('*')
      .eq('is_active', false)
      .not('closed_at', 'is', null)
      .order('closed_at', { ascending: false });

    if (data && !error) {
      setClosedSignals(data);
    }
    setIsLoading(false);
  };

  if (!isOpen) return null;

  const stats = {
    total: closedSignals.length,
    wins: closedSignals.filter(s => {
      const pnl = calculatePnlFromPrices(s.entry_price, s.current_price, s.direction);
      return pnl > 0;
    }).length,
    stopped: closedSignals.filter(s => s.hit_stop || s.outcome === 'stopped_out').length,
    avgPnl: closedSignals.length > 0 
      ? closedSignals.reduce((sum, s) => {
          const pnl = calculatePnlFromPrices(s.entry_price, s.current_price, s.direction);
          return sum + pnl;
        }, 0) / closedSignals.length 
      : 0,
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-card border border-border rounded-lg w-full max-w-2xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-3 sm:p-4 border-b border-border">
          <div>
            <h2 className="text-base sm:text-lg font-semibold">Track Record</h2>
            <p className="text-xs sm:text-sm text-muted-foreground">Historical performance</p>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-muted rounded"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-4 gap-2 sm:gap-4 p-3 sm:p-4 bg-muted/30 border-b border-border">
          <div className="text-center">
            <div className="text-xl sm:text-2xl font-bold font-mono">{stats.total}</div>
            <div className="text-[10px] sm:text-xs text-muted-foreground">Closed</div>
          </div>
          <div className="text-center">
            <div className="text-xl sm:text-2xl font-bold font-mono text-green-500">{stats.wins}</div>
            <div className="text-[10px] sm:text-xs text-muted-foreground">Winners</div>
          </div>
          <div className="text-center">
            <div className="text-xl sm:text-2xl font-bold font-mono text-red-500">{stats.stopped}</div>
            <div className="text-[10px] sm:text-xs text-muted-foreground">Stopped</div>
          </div>
          <div className="text-center">
            <div className={`text-xl sm:text-2xl font-bold font-mono ${stats.avgPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {stats.avgPnl >= 0 ? '+' : ''}{stats.avgPnl.toFixed(1)}%
            </div>
            <div className="text-[10px] sm:text-xs text-muted-foreground">Avg P&L</div>
          </div>
        </div>

        {/* Signals List */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-2 sm:space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : closedSignals.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No closed signals yet
            </div>
          ) : (
            closedSignals.map((signal) => {
              const outcome = getOutcomeDisplay(signal);
              const traders = Array.isArray(signal.traders) ? signal.traders : [];
              const isExpanded = expandedSignal === signal.id;
              const duration = signal.created_at && signal.closed_at 
                ? formatDuration(signal.created_at, signal.closed_at)
                : null;
              
              return (
                <div 
                  key={signal.id}
                  className="bg-background rounded-lg border border-border overflow-hidden"
                >
                  {/* Signal Header */}
                  <div 
                    className="p-2.5 sm:p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedSignal(isExpanded ? null : signal.id)}
                  >
                    {/* Top Row */}
                    <div className="flex items-center justify-between gap-2 mb-1.5 sm:mb-2">
                      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                        <span className="font-bold text-sm sm:text-base">{signal.coin}</span>
                        <span className={`text-[10px] sm:text-xs font-bold px-1.5 py-0.5 rounded ${
                          signal.direction === 'long' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
                        }`}>
                          {signal.direction.toUpperCase()}
                        </span>
                        <span className="text-[10px] sm:text-xs text-muted-foreground">
                          {signal.elite_count}E+{signal.good_count}G
                        </span>
                        {duration && (
                          <span className="text-[10px] sm:text-xs text-muted-foreground flex items-center gap-0.5">
                            <Timer className="h-3 w-3" />
                            {duration}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                        <div className="text-right">
                          <span className={`text-sm sm:text-base font-bold font-mono ${outcome.color}`}>
                            {outcome.label}
                          </span>
                          {outcome.sublabel && (
                            <div className="text-[10px] sm:text-xs text-muted-foreground">{outcome.sublabel}</div>
                          )}
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                    
                    {/* Bottom Row */}
                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <div className="flex items-center gap-2 sm:gap-4">
                        <span className="text-muted-foreground">
                          Entry: <span className="text-foreground font-mono">{formatPrice(signal.entry_price)}</span>
                        </span>
                        <span className="text-muted-foreground">
                          Exit: <span className="text-foreground font-mono">{formatPrice(signal.current_price)}</span>
                        </span>
                      </div>
                      <span className="text-[10px] sm:text-xs text-muted-foreground">
                        {signal.closed_at ? formatDateEST(signal.closed_at) : '-'}
                      </span>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="border-t border-border bg-muted/20 p-2.5 sm:p-3 space-y-2.5 sm:space-y-3">
                      {/* Price Targets */}
                      <div className="grid grid-cols-4 gap-1.5 sm:gap-2 text-xs">
                        <div className={`p-1.5 sm:p-2 rounded text-center ${signal.hit_stop ? 'bg-red-500/20' : 'bg-background'}`}>
                          <div className="text-muted-foreground text-[10px] sm:text-xs mb-0.5">Stop</div>
                          <div className={`font-mono text-[11px] sm:text-xs ${signal.hit_stop ? 'text-red-500 font-medium' : 'text-foreground'}`}>
                            {formatPrice(signal.stop_loss)}
                          </div>
                        </div>
                        <div className={`p-1.5 sm:p-2 rounded text-center ${signal.hit_tp1 ? 'bg-green-500/20' : 'bg-background'}`}>
                          <div className="text-muted-foreground text-[10px] sm:text-xs mb-0.5">TP1</div>
                          <div className={`font-mono text-[11px] sm:text-xs ${signal.hit_tp1 ? 'text-green-500 font-medium' : 'text-foreground'}`}>
                            {formatPrice(signal.take_profit_1)}
                          </div>
                        </div>
                        <div className={`p-1.5 sm:p-2 rounded text-center ${signal.hit_tp2 ? 'bg-green-500/20' : 'bg-background'}`}>
                          <div className="text-muted-foreground text-[10px] sm:text-xs mb-0.5">TP2</div>
                          <div className={`font-mono text-[11px] sm:text-xs ${signal.hit_tp2 ? 'text-green-500 font-medium' : 'text-foreground'}`}>
                            {formatPrice(signal.take_profit_2)}
                          </div>
                        </div>
                        <div className={`p-1.5 sm:p-2 rounded text-center ${signal.hit_tp3 ? 'bg-green-500/20' : 'bg-background'}`}>
                          <div className="text-muted-foreground text-[10px] sm:text-xs mb-0.5">TP3</div>
                          <div className={`font-mono text-[11px] sm:text-xs ${signal.hit_tp3 ? 'text-green-500 font-medium' : 'text-foreground'}`}>
                            {formatPrice(signal.take_profit_3)}
                          </div>
                        </div>
                      </div>

                      {/* Timeline */}
                      <div className="flex items-center justify-between text-[10px] sm:text-xs text-muted-foreground bg-background rounded p-1.5 sm:p-2">
                        <span>Opened: {signal.created_at ? formatDateEST(signal.created_at) : '-'}</span>
                        <span className="text-foreground">→</span>
                        <span>Closed: {signal.closed_at ? formatDateEST(signal.closed_at) : '-'}</span>
                      </div>

                      {/* Traders */}
                      {traders.length > 0 && (
                        <div>
                          <div className="text-[10px] sm:text-xs text-muted-foreground mb-1.5 sm:mb-2">
                            Traders ({traders.length})
                          </div>
                          <div className="space-y-1.5 sm:space-y-2">
                            {traders.map((trader) => {
                              const hasExitData = trader.exit_price !== null && trader.exit_price !== undefined;
                              const traderPnl = hasExitData && trader.entry_price
                                ? formatTraderEntry(trader.entry_price, trader.exit_price!, signal.direction)
                                : null;
                              
                              return (
                                <a
                                  key={trader.address}
                                  href={getTraderUrl(trader.address)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block p-2 bg-background rounded text-xs hover:bg-muted/50 transition-colors"
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1.5 sm:gap-2">
                                      <span className={`px-1 sm:px-1.5 py-0.5 rounded font-medium text-[10px] sm:text-xs ${
                                        trader.tier === 'elite' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500'
                                      }`}>
                                        {trader.tier === 'elite' ? 'E' : 'G'}
                                      </span>
                                      <span className="font-mono text-[10px] sm:text-xs text-muted-foreground">
                                        {trader.address.slice(0, 6)}...{trader.address.slice(-4)}
                                      </span>
                                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                    </div>
                                    <div className="flex items-center gap-1.5 sm:gap-2">
                                      {traderPnl && (
                                        <span className={`font-mono font-medium text-[10px] sm:text-xs ${traderPnl.pnlPct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                          {traderPnl.display}
                                        </span>
                                      )}
                                      <span className="text-muted-foreground text-[10px] sm:text-xs">
                                        {((trader.win_rate || 0) * 100).toFixed(0)}% WR
                                      </span>
                                    </div>
                                  </div>
                                  <div className="text-[10px] sm:text-xs text-muted-foreground pl-5 sm:pl-6">
                                    <span>
                                      Entry: <span className="font-mono text-foreground">{formatPrice(trader.entry_price)}</span>
                                      {trader.opened_at && (
                                        <span className="ml-1">({formatDateEST(trader.opened_at)})</span>
                                      )}
                                    </span>
                                  </div>
                                  {hasExitData && (
                                    <div className="text-[10px] sm:text-xs text-muted-foreground pl-5 sm:pl-6 mt-0.5">
                                      <span>
                                        Exit: <span className="font-mono text-foreground">{formatPrice(trader.exit_price!)}</span>
                                        {trader.exited_at && (
                                          <span className="ml-1">({formatDateEST(trader.exited_at)})</span>
                                        )}
                                        {trader.exit_type && trader.exit_type !== 'manual' && (
                                          <span className={`ml-1.5 px-1 py-0.5 rounded text-[9px] sm:text-[10px] ${
                                            trader.exit_type === 'stopped' ? 'bg-red-500/20 text-red-500' :
                                            trader.exit_type === 'liquidated' ? 'bg-red-500/20 text-red-500' :
                                            'bg-muted text-muted-foreground'
                                          }`}>
                                            {trader.exit_type}
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                  )}
                                </a>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// ANALYTICS MODAL
// ============================================

interface DailyStats {
  date: string;
  signals: number;
  elite: number;
  optimal: number;
  avg_pnl: string;
  stopped: number;
  winners: number;
}

function AnalyticsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [traderStats, setTraderStats] = useState<{ hot: number; cold: number; eliteHot: number; eliteCold: number }>({ hot: 0, cold: 0, eliteHot: 0, eliteCold: 0 });
  const [overallStats, setOverallStats] = useState<{ 
    totalPnl: number; 
    totalSignals: number; 
    winRate: number; 
    avgPnl: number;
    avgMaxProfit: number;
    avgMaxDrawdown: number;
    avgLeftOnTable: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    if (isOpen) {
      fetchAnalytics();
    }
  }, [isOpen]);

  const fetchAnalytics = async () => {
    setIsLoading(true);
    
    try {
      const { data: signals } = await supabase
        .from('quality_signals')
        .select('*')
        .eq('is_active', false)
        .not('closed_at', 'is', null)
        .order('closed_at', { ascending: false });

      if (signals) {
        const byDate = new Map<string, DailyStats>();
        
        signals.forEach(s => {
          const date = new Date(s.closed_at).toISOString().split('T')[0];
          const existing = byDate.get(date) || { 
            date, 
            signals: 0, 
            elite: 0, 
            optimal: 0, 
            avg_pnl: '0', 
            stopped: 0,
            winners: 0,
            totalPnl: 0 
          };
          
          const pnl = s.direction === 'long' 
            ? ((s.current_price - s.entry_price) / s.entry_price) * 100
            : ((s.entry_price - s.current_price) / s.entry_price) * 100;
          
          existing.signals++;
          if (s.signal_tier === 'elite_entry') existing.elite++;
          if (s.signal_tier === 'elite_entry' && s.total_traders === 1) existing.optimal++;
          if (s.hit_stop) existing.stopped++;
          if (pnl > 0) existing.winners++;
          (existing as any).totalPnl = ((existing as any).totalPnl || 0) + pnl;
          
          byDate.set(date, existing);
        });

        const dailyArray = Array.from(byDate.values()).map(d => ({
          ...d,
          avg_pnl: ((d as any).totalPnl / d.signals).toFixed(2)
        })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);

        setDailyStats(dailyArray);

        const totalPnl = signals.reduce((sum, s) => {
          const pnl = s.direction === 'long' 
            ? ((s.current_price - s.entry_price) / s.entry_price) * 100
            : ((s.entry_price - s.current_price) / s.entry_price) * 100;
          return sum + pnl;
        }, 0);
        
        const winners = signals.filter(s => {
          const pnl = s.direction === 'long' 
            ? ((s.current_price - s.entry_price) / s.entry_price) * 100
            : ((s.entry_price - s.current_price) / s.entry_price) * 100;
          return pnl > 0;
        }).length;

        const signalsWithMaxPnl = signals.filter(s => s.max_pnl_pct !== null && s.max_pnl_pct !== undefined);
        const avgMaxProfit = signalsWithMaxPnl.length > 0 
          ? signalsWithMaxPnl.reduce((sum, s) => sum + (s.max_pnl_pct || 0), 0) / signalsWithMaxPnl.length
          : 0;
        
        const signalsWithMinPnl = signals.filter(s => s.min_pnl_pct !== null && s.min_pnl_pct !== undefined);
        const avgMaxDrawdown = signalsWithMinPnl.length > 0
          ? signalsWithMinPnl.reduce((sum, s) => sum + (s.min_pnl_pct || 0), 0) / signalsWithMinPnl.length
          : 0;

        const avgLeftOnTable = signalsWithMaxPnl.length > 0
          ? signalsWithMaxPnl.reduce((sum, s) => {
              const actualPnl = s.direction === 'long' 
                ? ((s.current_price - s.entry_price) / s.entry_price) * 100
                : ((s.entry_price - s.current_price) / s.entry_price) * 100;
              return sum + Math.max(0, (s.max_pnl_pct || 0) - actualPnl);
            }, 0) / signalsWithMaxPnl.length
          : 0;

        setOverallStats({
          totalPnl,
          totalSignals: signals.length,
          winRate: (winners / signals.length) * 100,
          avgPnl: totalPnl / signals.length,
          avgMaxProfit,
          avgMaxDrawdown,
          avgLeftOnTable
        });
      }

      const { data: traders } = await supabase
        .from('trader_quality')
        .select('quality_tier, pnl_7d')
        .eq('is_tracked', true);

      if (traders) {
        const hot = traders.filter(t => t.pnl_7d >= 5000).length;
        const cold = traders.filter(t => t.pnl_7d < 5000).length;
        const eliteHot = traders.filter(t => t.quality_tier === 'elite' && t.pnl_7d >= 5000).length;
        const eliteCold = traders.filter(t => t.quality_tier === 'elite' && t.pnl_7d < 5000).length;
        setTraderStats({ hot, cold, eliteHot, eliteCold });
      }

    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    }
    
    setIsLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-card border border-border rounded-lg w-full max-w-2xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-3 sm:p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <h2 className="text-base sm:text-lg font-semibold">Performance Analytics</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-3 sm:p-4 flex-1 overflow-y-auto space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {overallStats && (
                <>
                  <div className="grid grid-cols-4 gap-2 sm:gap-3">
                    <div className="bg-muted/30 rounded-lg p-2 sm:p-3 text-center">
                      <div className="text-lg sm:text-2xl font-bold font-mono">{overallStats.totalSignals}</div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground">Total Closed</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2 sm:p-3 text-center">
                      <div className={`text-lg sm:text-2xl font-bold font-mono ${overallStats.winRate >= 50 ? 'text-green-500' : 'text-red-500'}`}>
                        {overallStats.winRate.toFixed(0)}%
                      </div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground">Win Rate</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2 sm:p-3 text-center">
                      <div className={`text-lg sm:text-2xl font-bold font-mono ${overallStats.avgPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {overallStats.avgPnl >= 0 ? '+' : ''}{overallStats.avgPnl.toFixed(2)}%
                      </div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground">Avg P&L</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2 sm:p-3 text-center">
                      <div className={`text-lg sm:text-2xl font-bold font-mono ${overallStats.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {overallStats.totalPnl >= 0 ? '+' : ''}{overallStats.totalPnl.toFixed(1)}%
                      </div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground">Cumulative</div>
                    </div>
                  </div>

                  <div className="bg-muted/20 rounded-lg p-3">
                    <h3 className="text-sm font-medium mb-2">Profit Efficiency</h3>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Avg Max Profit</span>
                        <span className="font-mono font-medium text-green-500">+{overallStats.avgMaxProfit.toFixed(2)}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Avg Max Drawdown</span>
                        <span className="font-mono font-medium text-red-500">{overallStats.avgMaxDrawdown.toFixed(2)}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Avg Left on Table</span>
                        <span className="font-mono font-medium text-yellow-500">{overallStats.avgLeftOnTable.toFixed(2)}%</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Signals reached +{overallStats.avgMaxProfit.toFixed(2)}% avg max profit but exited at +{overallStats.avgPnl.toFixed(2)}%
                    </p>
                  </div>
                </>
              )}

              <div className="bg-muted/20 rounded-lg p-3">
                <h3 className="text-sm font-medium mb-2">Trader Health</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Hot Traders (≥$5k 7d)</span>
                    <span className="font-mono font-medium text-green-500">{traderStats.hot}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Cold Traders (&lt;$5k 7d)</span>
                    <span className="font-mono font-medium text-yellow-500">{traderStats.cold}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Hot Elites</span>
                    <span className="font-mono font-medium text-green-500">{traderStats.eliteHot}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Cold Elites</span>
                    <span className="font-mono font-medium text-yellow-500">{traderStats.eliteCold}</span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Daily Performance (Last 14 Days)</h3>
                <div className="bg-muted/10 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left p-2 font-medium">Date</th>
                        <th className="text-center p-2 font-medium">Signals</th>
                        <th className="text-center p-2 font-medium">Elite</th>
                        <th className="text-center p-2 font-medium">Optimal</th>
                        <th className="text-center p-2 font-medium">Winners</th>
                        <th className="text-center p-2 font-medium">Stopped</th>
                        <th className="text-right p-2 font-medium">Avg P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyStats.map((day, i) => (
                        <tr key={day.date} className={i % 2 === 0 ? '' : 'bg-muted/10'}>
                          <td className="p-2 font-mono">{day.date.slice(5)}</td>
                          <td className="p-2 text-center font-mono">{day.signals}</td>
                          <td className="p-2 text-center font-mono text-yellow-500">{day.elite}</td>
                          <td className="p-2 text-center font-mono text-purple-500">{day.optimal}</td>
                          <td className="p-2 text-center font-mono text-green-500">{day.winners}</td>
                          <td className="p-2 text-center font-mono text-red-500">{day.stopped}</td>
                          <td className={`p-2 text-right font-mono font-medium ${parseFloat(day.avg_pnl) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {parseFloat(day.avg_pnl) >= 0 ? '+' : ''}{day.avg_pnl}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                <h3 className="text-sm font-medium text-blue-500 mb-2">Key Insight</h3>
                <p className="text-xs text-muted-foreground">
                  Based on your data, <span className="text-foreground font-medium">Elite Entry signals with 1 trader</span> show 
                  {' '}<span className="text-green-500 font-medium">69% win rate</span> and 
                  {' '}<span className="text-green-500 font-medium">+0.91% avg P&L</span>. 
                  Use the Elite + Solo filters to focus on these optimal signals.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-border p-3 flex justify-between items-center">
          <button
            onClick={fetchAnalytics}
            disabled={isLoading}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Loader2 className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded-md"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// WALLET IMPORT MODAL
// ============================================

function WalletImportModal({ 
  isOpen, 
  onClose,
  onComplete
}: { 
  isOpen: boolean; 
  onClose: () => void;
  onComplete: () => void;
}) {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const supabase = createClient();

  const analyzeTrader = async (address: string): Promise<{
    tier: 'elite' | 'good' | 'weak';
    pnl_7d: number;
    account_value: number;
    win_rate: number;
    error?: string;
  }> => {
    try {
      const stateRes = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clearinghouseState', user: address })
      });
      
      if (!stateRes.ok) throw new Error('Failed to fetch account state');
      const state = await stateRes.json();
      const accountValue = parseFloat(state.marginSummary?.accountValue || '0');
      
      if (accountValue < 1000) {
        return { tier: 'weak', pnl_7d: 0, account_value: accountValue, win_rate: 0, error: 'Account too small' };
      }

      const fillsRes = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'userFills', user: address })
      });
      
      if (!fillsRes.ok) throw new Error('Failed to fetch fills');
      const fills = await fillsRes.json();
      
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentFills = fills.filter((f: any) => f.time >= sevenDaysAgo);
      const pnl_7d = recentFills.reduce((sum: number, f: any) => sum + parseFloat(f.closedPnl || '0'), 0);
      
      const closingFills = recentFills.filter((f: any) => parseFloat(f.closedPnl || '0') !== 0);
      const wins = closingFills.filter((f: any) => parseFloat(f.closedPnl || '0') > 0).length;
      const win_rate = closingFills.length > 0 ? wins / closingFills.length : 0;
      
      let tier: 'elite' | 'good' | 'weak' = 'weak';
      const roi_7d = accountValue > 0 ? (pnl_7d / accountValue) * 100 : 0;
      
      if (pnl_7d >= 25000 && roi_7d >= 10 && win_rate >= 0.5 && accountValue >= 50000) {
        tier = 'elite';
      } else if (pnl_7d >= 5000 && roi_7d >= 5 && win_rate >= 0.45 && accountValue >= 10000) {
        tier = 'good';
      }
      
      return { tier, pnl_7d, account_value: accountValue, win_rate };
    } catch (error) {
      return { tier: 'weak', pnl_7d: 0, account_value: 0, win_rate: 0, error: String(error) };
    }
  };

  const handleImport = async () => {
    const addresses = parseAddresses(input);
    
    if (addresses.length === 0) {
      alert('No valid addresses found. Addresses must start with 0x and be 42 characters.');
      return;
    }

    setIsProcessing(true);
    setProgress({
      current: 0,
      total: addresses.length,
      currentAddress: '',
      status: 'inserting',
      results: []
    });

    const results: ImportProgress['results'] = [];

    for (let i = 0; i < addresses.length; i++) {
      const address = addresses[i];
      
      setProgress(prev => ({
        ...prev!,
        current: i + 1,
        currentAddress: address,
        status: 'analyzing'
      }));

      await new Promise(resolve => setTimeout(resolve, 300));

      try {
        const analysis = await analyzeTrader(address);
        
        const { data: existing } = await supabase
          .from('trader_quality')
          .select('address')
          .eq('address', address)
          .single();
        
        if (existing) {
          const { error: dbError } = await supabase
            .from('trader_quality')
            .update({
              quality_tier: analysis.tier,
              is_tracked: analysis.tier === 'elite' || analysis.tier === 'good',
              pnl_7d: analysis.pnl_7d,
              account_value: analysis.account_value,
              win_rate: analysis.win_rate,
              analyzed_at: new Date().toISOString(),
            })
            .eq('address', address);
          
          if (dbError) throw dbError;
        } else {
          const { error: dbError } = await supabase
            .from('trader_quality')
            .insert({
              address: address,
              quality_tier: analysis.tier,
              is_tracked: analysis.tier === 'elite' || analysis.tier === 'good',
              pnl_7d: analysis.pnl_7d,
              account_value: analysis.account_value,
              win_rate: analysis.win_rate,
              analyzed_at: new Date().toISOString(),
            });
          
          if (dbError) throw dbError;
        }

        results.push({
          address,
          tier: analysis.tier,
          pnl_7d: analysis.pnl_7d,
          status: 'success'
        });
      } catch (error) {
        results.push({
          address,
          tier: 'weak',
          pnl_7d: 0,
          status: 'error',
          error: String(error)
        });
      }

      setProgress(prev => ({
        ...prev!,
        results: [...results]
      }));
    }

    setProgress(prev => ({
      ...prev!,
      status: 'done'
    }));

    setIsProcessing(false);
  };

  const handleClose = () => {
    if (!isProcessing) {
      setInput('');
      setProgress(null);
      onClose();
      if (progress?.status === 'done') {
        onComplete();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-card border border-border rounded-lg w-full max-w-lg max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-3 sm:p-4 border-b border-border">
          <h2 className="text-base sm:text-lg font-semibold">Import Wallets</h2>
          <button 
            onClick={handleClose}
            disabled={isProcessing}
            className="p-1 hover:bg-muted rounded disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-3 sm:p-4 flex-1 overflow-y-auto">
          {!progress ? (
            <>
              <p className="text-xs sm:text-sm text-muted-foreground mb-3">
                Paste wallet addresses (comma, space, or newline separated).
              </p>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="0x1234...&#10;0x5678..."
                className="w-full h-32 sm:h-40 p-2 sm:p-3 bg-background border border-border rounded-lg text-xs sm:text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-2">
                {parseAddresses(input).length} valid addresses detected
              </p>
            </>
          ) : (
            <div className="space-y-4">
              <div className="text-center">
                <div className="text-3xl sm:text-4xl font-bold font-mono text-primary mb-2">
                  {progress.current}/{progress.total}
                </div>
                <div className="text-xs sm:text-sm text-muted-foreground">
                  {progress.status === 'done' ? (
                    'Complete!'
                  ) : (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                      Analyzing {progress.currentAddress.slice(0, 8)}...
                    </>
                  )}
                </div>
              </div>

              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>

              {progress.results.length > 0 && (
                <div className="space-y-1.5 sm:space-y-2 max-h-48 sm:max-h-60 overflow-y-auto">
                  {progress.results.map((result, idx) => (
                    <div 
                      key={idx}
                      className="flex items-center justify-between p-2 bg-background rounded text-xs sm:text-sm"
                    >
                      <span className="font-mono text-[10px] sm:text-xs">
                        {result.address.slice(0, 8)}...{result.address.slice(-4)}
                      </span>
                      <div className="flex items-center gap-2">
                        {result.status === 'success' ? (
                          <>
                            <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded ${
                              result.tier === 'elite' ? 'bg-green-500/20 text-green-500' :
                              result.tier === 'good' ? 'bg-blue-500/20 text-blue-500' :
                              'bg-muted text-muted-foreground'
                            }`}>
                              {result.tier.toUpperCase()}
                            </span>
                            <span className={`font-mono text-[10px] sm:text-xs ${result.pnl_7d >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {formatPnl(result.pnl_7d)}
                            </span>
                          </>
                        ) : (
                          <span className="text-red-500 text-[10px] sm:text-xs">Error</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {progress.status === 'done' && (
                <div className="bg-muted/50 rounded-lg p-3 text-sm">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-green-500 font-bold font-mono">
                        {progress.results.filter(r => r.tier === 'elite').length}
                      </div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground">Elite</div>
                    </div>
                    <div>
                      <div className="text-blue-500 font-bold font-mono">
                        {progress.results.filter(r => r.tier === 'good').length}
                      </div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground">Good</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground font-bold font-mono">
                        {progress.results.filter(r => r.tier === 'weak').length}
                      </div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground">Weak</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-3 sm:p-4 border-t border-border">
          {!progress ? (
            <button
              onClick={handleImport}
              disabled={parseAddresses(input).length === 0}
              className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Import & Analyze {parseAddresses(input).length > 0 && `(${parseAddresses(input).length})`}
            </button>
          ) : progress.status === 'done' ? (
            <button
              onClick={handleClose}
              className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
            >
              Done
            </button>
          ) : (
            <button
              disabled
              className="w-full py-2 bg-muted text-muted-foreground rounded-lg text-sm font-medium cursor-not-allowed"
            >
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
              Processing...
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// SIGNAL PERFORMANCE SUMMARY
// ============================================

function SignalPerformanceSummary({ 
  stats, 
  onClick,
  onAnalyticsClick
}: { 
  stats: SignalStats | null;
  onClick: () => void;
  onAnalyticsClick: () => void;
}) {
  if (!stats || stats.total === 0) return null;
  
  return (
    <div className="flex gap-2 mb-4 sm:mb-6">
      <button
        onClick={onClick}
        className="flex-1 flex items-baseline gap-2 sm:gap-3 text-sm bg-muted/40 hover:bg-muted/60 rounded-lg px-4 py-3 transition-colors border border-border/50"
      >
        <span className="text-muted-foreground">Track Record:</span>
        <span className="font-bold font-mono">{stats.total}</span>
        <span className="text-muted-foreground">closed</span>
        <span className="text-muted-foreground hidden sm:inline">·</span>
        <span className="font-bold font-mono text-green-500 hidden sm:inline">{stats.wins}</span>
        <span className="text-green-500 hidden sm:inline">wins</span>
        <span className="text-muted-foreground hidden sm:inline">·</span>
        <span className="font-bold font-mono text-red-500 hidden sm:inline">{stats.stopped}</span>
        <span className="text-red-500 hidden sm:inline">stopped</span>
        <span className="text-muted-foreground">·</span>
        <span className={`font-bold font-mono ${stats.win_rate >= 50 ? 'text-green-500' : 'text-red-500'}`}>
          {stats.win_rate.toFixed(0)}%
        </span>
        <span className="text-muted-foreground">WR</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto self-center" />
      </button>
      <button
        onClick={onAnalyticsClick}
        className="px-3 py-3 bg-muted/40 hover:bg-muted/60 rounded-lg transition-colors border border-border/50 flex items-center gap-1.5"
        title="View Analytics"
      >
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
}

// ============================================
// SIGNAL CARD (Compact - Opens Bottom Sheet)
// ============================================

function SignalCard({ signal, onClick }: { 
  signal: QualitySignal; 
  onClick: () => void;
}) {
  const traders = Array.isArray(signal.traders) ? signal.traders : [];
  const isLong = signal.direction === 'long';
  
  const openedDates = traders.map(t => t.opened_at).filter((d): d is string => d !== null && d !== undefined);
  const earliestEntry = openedDates.length > 0 
    ? openedDates.reduce((earliest, d) => new Date(d) < new Date(earliest) ? d : earliest)
    : signal.created_at;
  
  const entry = signal.entry_price || signal.current_price;
  const current = signal.current_price;
  const pnlPct = signal.current_pnl_pct || calculatePnlFromPrices(entry, current, signal.direction);
  const isProfit = pnlPct >= 0;

  const traderDisplay = () => {
    if (signal.elite_count > 0 && signal.good_count > 0) {
      return `${signal.elite_count}E + ${signal.good_count}G`;
    } else if (signal.elite_count > 0) {
      return `${signal.elite_count}E`;
    } else if (signal.good_count > 0) {
      return `${signal.good_count}G`;
    }
    return '';
  };
  
  return (
    <div 
      className="bg-card border border-border rounded-lg p-3 cursor-pointer hover:bg-muted/30 transition-colors active:bg-muted/50"
      onClick={onClick}
    >
      {/* Row 1: Coin, Direction, Trader Count | P&L */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold">{signal.coin}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
            isLong ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
          }`}>
            {signal.direction.toUpperCase()}
          </span>
          <span className="text-xs text-muted-foreground">{traderDisplay()}</span>
        </div>
        <span className={`text-base font-bold font-mono ${isProfit ? 'text-green-500' : 'text-red-500'}`}>
          {isProfit ? '+' : ''}{pnlPct.toFixed(2)}%
        </span>
      </div>
      
      {/* Row 2: Entry → Current | Stop */}
      <div className="flex items-center justify-between mb-1.5 text-sm">
        <span className="font-mono">
          {formatPrice(entry)} <span className="text-muted-foreground mx-1">→</span> {formatPrice(current)}
        </span>
        <span className="text-red-500 text-sm">
          Stop: {formatPrice(signal.stop_loss)}
        </span>
      </div>
      
      {/* Row 3: Opened time */}
      <div className="text-xs text-muted-foreground">
        {formatDateTimeEST(earliestEntry)}
      </div>
    </div>
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
  const [eliteOnly, setEliteOnly] = useState(false);
  const [singleTrader, setSingleTrader] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<QualitySignal | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>('');
  const [mounted, setMounted] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showTrackRecord, setShowTrackRecord] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);

  const supabase = createClient();

  const fetchSignals = useCallback(async () => {
    setIsLoading(true);
    
    const { data, error } = await supabase
      .from('quality_signals')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

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
      .select('outcome, hit_tp1, hit_tp2, hit_tp3, hit_stop, final_pnl_pct, entry_price, current_price, direction')
      .eq('is_active', false)
      .not('closed_at', 'is', null);

    if (data) {
      const total = data.length;
      const wins = data.filter(s => {
        if (s.entry_price && s.current_price) {
          const pnl = s.direction === 'long' 
            ? ((s.current_price - s.entry_price) / s.entry_price) * 100
            : ((s.entry_price - s.current_price) / s.entry_price) * 100;
          return pnl > 0;
        }
        return s.hit_tp1 || s.hit_tp2 || s.hit_tp3 || s.outcome === 'profit' || (s.final_pnl_pct && s.final_pnl_pct > 0);
      }).length;
      const stopped = data.filter(s => s.hit_stop || s.outcome === 'stopped_out').length;
      
      setSignalStats({
        total,
        wins,
        stopped,
        open: 0,
        win_rate: total > 0 ? (wins / total) * 100 : 0
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

  const getMostRecentEntryTime = (signal: QualitySignal): number => {
    const traders = Array.isArray(signal.traders) ? signal.traders : [];
    const openedDates = traders
      .map(t => t.opened_at)
      .filter((d): d is string => d !== null && d !== undefined);
    
    if (openedDates.length === 0) return new Date(signal.created_at).getTime();
    
    return Math.max(...openedDates.map(d => new Date(d).getTime()));
  };

  const filteredSignals = signals
    .filter((s) => {
      if (filter === 'strong' && s.signal_strength !== 'strong') return false;
      if (filter === 'long' && s.direction !== 'long') return false;
      if (filter === 'short' && s.direction !== 'short') return false;
      if (eliteOnly && s.signal_tier !== 'elite_entry') return false;
      if (singleTrader && (s.total_traders || 0) > 1) return false;
      return true;
    })
    .sort((a, b) => getMostRecentEntryTime(b) - getMostRecentEntryTime(a));

  if (!mounted) {
    return (
      <div className="min-h-screen bg-background font-sans">
        <header className="border-b border-border">
          <div className="max-w-lg mx-auto px-4 py-4">
            <h1 className="text-xl font-semibold">Quality Signals</h1>
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background font-sans">
      <header className="border-b border-border sticky top-0 bg-background z-20">
        <div className="max-w-lg mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-base sm:text-xl font-semibold">Quality Signals</h1>
              <p className="text-[10px] sm:text-sm text-muted-foreground">
                Following {stats?.tracked_count || 0} traders
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              {stats && (
                <div className="text-[10px] sm:text-sm">
                  <span className="text-green-500 font-medium">{stats.elite_count} E</span>
                  <span className="text-muted-foreground mx-1">·</span>
                  <span className="text-blue-500 font-medium">{stats.good_count} G</span>
                </div>
              )}
              <button
                onClick={() => setShowImportModal(true)}
                className="p-1.5 sm:p-2 bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
                title="Import Wallets"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="px-2 sm:px-3 py-1.5 text-[10px] sm:text-sm bg-secondary hover:bg-secondary/80 rounded-md transition-colors disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <SignalPerformanceSummary 
          stats={signalStats} 
          onClick={() => setShowTrackRecord(true)}
          onAnalyticsClick={() => setShowAnalytics(true)}
        />
        
        <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-4 sm:mb-6">
          {/* Direction filters */}
          <div className="flex gap-1.5 sm:gap-2">
            {(['all', 'long', 'short'] as const).map((f) => {
              const count = f === 'all' 
                ? signals.length 
                : signals.filter(s => s.direction === f).length;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                    filter === f 
                      ? f === 'long' ? 'bg-green-600 text-white'
                      : f === 'short' ? 'bg-red-600 text-white'
                      : 'bg-primary text-primary-foreground'
                      : 'bg-secondary hover:bg-secondary/80'
                  }`}
                >
                  <span>{f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1) + 's'}</span>
                  <span className={`text-[10px] px-1 py-0.5 rounded ${
                    filter === f ? 'bg-white/20' : 'bg-muted'
                  }`}>{count}</span>
                </button>
              );
            })}
          </div>
          
          <div className="w-px h-6 bg-border self-center mx-1 hidden sm:block" />
          
          {/* Quality filters */}
          <div className="flex gap-1.5 sm:gap-2">
            <button
              onClick={() => setEliteOnly(!eliteOnly)}
              className={`px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                eliteOnly 
                  ? 'bg-yellow-600 text-white'
                  : 'bg-secondary hover:bg-secondary/80'
              }`}
            >
              <span>Elite</span>
              <span className={`text-[10px] px-1 py-0.5 rounded ${
                eliteOnly ? 'bg-white/20' : 'bg-muted'
              }`}>{signals.filter(s => s.signal_tier === 'elite_entry').length}</span>
            </button>
            
            <button
              onClick={() => setSingleTrader(!singleTrader)}
              className={`px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                singleTrader 
                  ? 'bg-purple-600 text-white'
                  : 'bg-secondary hover:bg-secondary/80'
              }`}
            >
              <span>Solo</span>
              <span className={`text-[10px] px-1 py-0.5 rounded ${
                singleTrader ? 'bg-white/20' : 'bg-muted'
              }`}>{signals.filter(s => (s.total_traders || 0) === 1).length}</span>
            </button>
          </div>
        </div>
        
        {/* Active filter indicator */}
        {(eliteOnly || singleTrader) && (
          <div className="mb-4 p-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-yellow-500 font-medium">
                {filteredSignals.length} optimal signal{filteredSignals.length !== 1 ? 's' : ''}
              </span>
              <span className="text-muted-foreground">
                ({eliteOnly && 'Elite Entry'}{eliteOnly && singleTrader && ' + '}{singleTrader && '1 Trader'})
              </span>
              <span className="text-green-500 hidden sm:inline">· 69% WR, +0.91% avg</span>
            </div>
            <button 
              onClick={() => { setEliteOnly(false); setSingleTrader(false); }}
              className="text-yellow-500 hover:text-yellow-400 font-medium"
            >
              Clear
            </button>
          </div>
        )}

        {filteredSignals.length > 0 ? (
          <div className="space-y-2.5">
            {filteredSignals.map((signal) => (
              <SignalCard 
                key={signal.id} 
                signal={signal}
                onClick={() => setSelectedSignal(signal)}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 sm:py-12 text-center">
              <h3 className="text-base sm:text-lg font-medium mb-2">
                {(eliteOnly || singleTrader || filter !== 'all') 
                  ? 'No Matching Signals' 
                  : 'No Active Signals'}
              </h3>
              <p className="text-muted-foreground text-xs sm:text-sm">
                {(eliteOnly || singleTrader || filter !== 'all') 
                  ? `No signals match your current filters. ${signals.length} total signal${signals.length !== 1 ? 's' : ''} active.`
                  : 'Signals appear when elite traders open positions or multiple quality traders converge.'}
              </p>
              {(eliteOnly || singleTrader || filter !== 'all') && signals.length > 0 && (
                <button
                  onClick={() => { setFilter('all'); setEliteOnly(false); setSingleTrader(false); }}
                  className="mt-3 text-sm text-primary hover:underline"
                >
                  Clear all filters
                </button>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-center gap-2 mt-6 text-[10px] sm:text-sm text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span>Live · Updated {lastRefresh}</span>
        </div>
      </main>

      {/* Bottom Sheet */}
      <SignalBottomSheet
        signal={selectedSignal}
        isOpen={selectedSignal !== null}
        onClose={() => setSelectedSignal(null)}
      />

      <WalletImportModal 
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onComplete={() => {
          fetchStats();
          fetchSignals();
        }}
      />

      <TrackRecordModal
        isOpen={showTrackRecord}
        onClose={() => setShowTrackRecord(false)}
      />

      <AnalyticsModal
        isOpen={showAnalytics}
        onClose={() => setShowAnalytics(false)}
      />
    </div>
  );
}