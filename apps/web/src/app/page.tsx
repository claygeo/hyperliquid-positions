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
  Timer
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
  // V12: Exit tracking fields
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

function formatTimeWithEST(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  const estTime = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York'
  });
  
  const estDate = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York'
  });
  
  let ago: string;
  if (diffMins < 1) ago = 'just now';
  else if (diffMins < 60) ago = `${diffMins}m ago`;
  else if (diffHours < 24) ago = `${diffHours}h ago`;
  else ago = `${diffDays}d ago`;
  
  if (diffHours >= 24) {
    return `${ago} (${estDate}, ${estTime} EST)`;
  }
  
  return `${ago} (${estTime} EST)`;
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
  return `https://legacy.hyperdash.com/trader/${address}`;
}

function parseAddresses(input: string): string[] {
  const addresses = input
    .split(/[\s,\n]+/)
    .map(addr => addr.trim().toLowerCase())
    .filter(addr => addr.startsWith('0x') && addr.length === 42);
  
  return [...new Set(addresses)];
}

// Human-readable invalidation reasons
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

// Calculate P&L from entry/exit prices
function calculatePnlFromPrices(entryPrice: number, exitPrice: number, direction: string): number {
  if (!entryPrice || !exitPrice) return 0;
  
  if (direction === 'long') {
    return ((exitPrice - entryPrice) / entryPrice) * 100;
  } else {
    return ((entryPrice - exitPrice) / entryPrice) * 100;
  }
}

function getOutcomeDisplay(signal: QualitySignal): { label: string; color: string; sublabel?: string } {
  // Calculate P&L from actual prices (more accurate than stored final_pnl_pct)
  const calculatedPnl = calculatePnlFromPrices(
    signal.entry_price, 
    signal.current_price, 
    signal.direction
  );
  
  // Use calculated P&L, fall back to stored if no prices
  const pnl = (signal.entry_price && signal.current_price) ? calculatedPnl : (signal.final_pnl_pct || 0);
  const pnlDisplay = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`;
  const pnlColor = pnl >= 0 ? 'text-green-500' : 'text-red-500';
  
  // TP hits - show P&L with TP label
  if (signal.hit_tp3) return { label: pnlDisplay, color: 'text-green-500', sublabel: 'TP3 Hit' };
  if (signal.hit_tp2) return { label: pnlDisplay, color: 'text-green-500', sublabel: 'TP2 Hit' };
  if (signal.hit_tp1) return { label: pnlDisplay, color: 'text-green-400', sublabel: 'TP1 Hit' };
  
  // Stopped - show P&L with "Stopped" sublabel
  if (signal.hit_stop || signal.outcome === 'stopped_out') {
    return { label: pnlDisplay, color: 'text-red-500', sublabel: 'Stopped' };
  }
  
  // Invalidated with reason - show P&L with reason
  if (signal.invalidation_reason) {
    const reasonText = formatInvalidationReason(signal.invalidation_reason);
    return {
      label: pnlDisplay,
      color: pnlColor,
      sublabel: reasonText
    };
  }
  
  // Generic outcome - just show P&L
  return { label: pnlDisplay, color: pnlColor };
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
      .order('closed_at', { ascending: false })
      .limit(50);

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
                    {/* Top Row: Coin, Direction, Stats, P&L */}
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
                    
                    {/* Bottom Row: Entry, Exit, Date */}
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
                                  {/* Entry Row */}
                                  <div className="text-[10px] sm:text-xs text-muted-foreground pl-5 sm:pl-6">
                                    <span>
                                      Entry: <span className="font-mono text-foreground">{formatPrice(trader.entry_price)}</span>
                                      {trader.opened_at && (
                                        <span className="ml-1">({formatDateEST(trader.opened_at)})</span>
                                      )}
                                    </span>
                                  </div>
                                  {/* Exit Row */}
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
// SIGNAL PERFORMANCE SUMMARY (Clickable)
// ============================================

function SignalPerformanceSummary({ 
  stats, 
  onClick 
}: { 
  stats: SignalStats | null;
  onClick: () => void;
}) {
  if (!stats || stats.total === 0) return null;
  
  const closedCount = stats.total - stats.open;
  if (closedCount === 0) return null;
  
  return (
    <button
      onClick={onClick}
      className="w-full flex flex-wrap items-center gap-1.5 sm:gap-3 text-xs sm:text-sm bg-muted/30 hover:bg-muted/50 rounded-lg px-3 py-2 mb-4 sm:mb-6 transition-colors text-left"
    >
      <span className="text-muted-foreground">Track Record:</span>
      <span className="font-medium font-mono">{closedCount}</span>
      <span className="text-muted-foreground">closed</span>
      <span className="text-muted-foreground">·</span>
      <span className={`font-mono font-medium ${stats.win_rate >= 50 ? 'text-green-500' : 'text-red-500'}`}>
        {stats.win_rate.toFixed(0)}%
      </span>
      <span className="text-muted-foreground">WR</span>
      <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto" />
    </button>
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
  
  const traders = Array.isArray(signal.traders) ? signal.traders : [];
  
  const openedDates = traders
    .map(t => t.opened_at)
    .filter((d): d is string => d !== null && d !== undefined);
  
  const mostRecentEntry = openedDates.length > 0 
    ? openedDates.reduce((latest, d) => new Date(d) > new Date(latest) ? d : latest)
    : null;
  
  const entryTimeDisplay = mostRecentEntry ? formatTimeWithEST(mostRecentEntry) : null;
  
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-4 text-xs sm:text-sm">
      <div className="flex items-center gap-1.5 sm:gap-2">
        <span className="text-muted-foreground">Entry</span>
        <span className="font-mono font-medium">{formatPrice(entry)}</span>
        {entryTimeDisplay && (
          <span className="text-muted-foreground text-[10px] sm:text-xs hidden sm:inline">({entryTimeDisplay})</span>
        )}
      </div>
      <span className="text-muted-foreground hidden sm:inline">→</span>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <span className="text-muted-foreground">Now</span>
        <span className="font-mono font-medium">{formatPrice(current)}</span>
        <span className={`font-mono font-medium ${isProfit ? 'text-green-500' : 'text-red-500'}`}>
          ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
        </span>
      </div>
    </div>
  );
}

// ============================================
// SIGNAL TIER BADGE
// ============================================

function SignalTierBadge({ signal }: { signal: QualitySignal }) {
  const tier = signal.signal_tier;
  const eliteCount = signal.elite_count || 0;
  const goodCount = signal.good_count || 0;
  
  if (tier === 'elite_entry') {
    return (
      <span className="text-[10px] sm:text-xs font-medium px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-500">
        Elite
      </span>
    );
  }
  
  return (
    <span className="text-[10px] sm:text-xs text-muted-foreground">
      {eliteCount > 0 && <span className="text-green-500">{eliteCount}E</span>}
      {eliteCount > 0 && goodCount > 0 && '+'}
      {goodCount > 0 && <span className="text-blue-500">{goodCount}G</span>}
    </span>
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
        <div 
          className="p-3 sm:p-4 cursor-pointer hover:bg-muted/30 transition-colors"
          onClick={onToggle}
        >
          {/* Header row */}
          <div className="flex items-start sm:items-center justify-between mb-2 sm:mb-3 gap-2">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="text-base sm:text-xl font-bold">{signal.coin}</span>
                <span className={`text-[10px] sm:text-xs font-bold px-1.5 sm:px-2 py-0.5 rounded ${
                  isLong ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
                }`}>
                  {signal.direction.toUpperCase()}
                </span>
              </div>
              
              <SignalTierBadge signal={signal} />
              
              {signal.funding_context === 'favorable' && (
                <span className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded bg-green-500/10 text-green-500 flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  <span className="hidden sm:inline">Funding pays you</span>
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <span className="text-[10px] sm:text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>{formatTimeAgo(signal.updated_at || signal.created_at).replace(' ago', '')}</span>
              </span>
              {isExpanded ? (
                <ChevronUp className="h-4 sm:h-5 w-4 sm:w-5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 sm:h-5 w-4 sm:w-5 text-muted-foreground" />
              )}
            </div>
          </div>
          
          {/* Price + Stop */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2">
            <PriceDisplay signal={signal} />
            <div className="text-xs sm:text-sm">
              <span className="text-muted-foreground">Stop: </span>
              <span className="text-red-500 font-mono">
                {formatPrice(signal.stop_loss)} 
                <span className="text-[10px] sm:text-xs ml-1">(-{stopPct.toFixed(1)}%)</span>
              </span>
            </div>
          </div>
        </div>
        
        {/* Expanded View */}
        {isExpanded && (
          <div className="border-t border-border bg-muted/20 p-3 sm:p-4 space-y-3 sm:space-y-4">
            {/* Take Profit Levels */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4 text-xs sm:text-sm">
              <div className="bg-background rounded-lg p-2 sm:p-3 text-center">
                <div className="text-green-400 text-[10px] sm:text-xs mb-1">TP1 (1:1)</div>
                <div className="font-mono font-medium text-green-400 text-xs sm:text-sm">{formatPrice(signal.take_profit_1)}</div>
              </div>
              <div className="bg-background rounded-lg p-2 sm:p-3 text-center">
                <div className="text-green-500 text-[10px] sm:text-xs mb-1">TP2 (2:1)</div>
                <div className="font-mono font-medium text-green-500 text-xs sm:text-sm">{formatPrice(signal.take_profit_2)}</div>
              </div>
              <div className="bg-background rounded-lg p-2 sm:p-3 text-center">
                <div className="text-green-600 text-[10px] sm:text-xs mb-1">TP3 (3:1)</div>
                <div className="font-mono font-medium text-green-600 text-xs sm:text-sm">{formatPrice(signal.take_profit_3)}</div>
              </div>
            </div>
            
            {/* Traders List */}
            {traders.length > 0 && (
              <div>
                <div className="text-[10px] sm:text-xs text-muted-foreground mb-2">Traders ({traders.length})</div>
                <div className="space-y-2">
                  {traders.map((trader) => {
                    const traderEntry = trader.entry_price || 0;
                    const currentPrice = signal.current_price || 0;
                    const traderPnl = traderEntry && currentPrice 
                      ? formatTraderEntry(traderEntry, currentPrice, signal.direction)
                      : null;
                    
                    const entryTime = trader.opened_at 
                      ? formatTimeWithEST(trader.opened_at)
                      : null;
                    
                    return (
                      <a
                        key={trader.address}
                        href={getTraderUrl(trader.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-2 bg-background rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            <span className={`text-[10px] sm:text-xs px-1 sm:px-1.5 py-0.5 rounded font-medium ${
                              trader.tier === 'elite' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500'
                            }`}>
                              {trader.tier === 'elite' ? 'E' : 'G'}
                            </span>
                            <span className="font-mono text-[10px] sm:text-xs text-muted-foreground">
                              {trader.address.slice(0, 6)}...{trader.address.slice(-4)}
                            </span>
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                          </div>
                          <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs">
                            <span className={`font-mono ${(trader.pnl_7d || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {formatPnl(trader.pnl_7d || 0)}
                            </span>
                            <span className="text-muted-foreground">
                              {((trader.win_rate || 0) * 100).toFixed(0)}% WR
                            </span>
                          </div>
                        </div>
                        {/* Entry details row */}
                        <div className="flex items-center justify-between text-[10px] sm:text-xs text-muted-foreground pl-1">
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            {traderEntry > 0 && (
                              <>
                                <span>Entry: <span className="font-mono text-foreground">{formatPrice(traderEntry)}</span></span>
                                {traderPnl && (
                                  <span className={`font-mono ${traderPnl.pnlPct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    ({traderPnl.display})
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                          {entryTime && (
                            <span className="text-[10px] sm:text-xs hidden sm:inline">{entryTime}</span>
                          )}
                        </div>
                      </a>
                    );
                  })}
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
  const [showImportModal, setShowImportModal] = useState(false);
  const [showTrackRecord, setShowTrackRecord] = useState(false);

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
      .select('outcome, hit_tp1, hit_tp2, hit_tp3, hit_stop, final_pnl_pct, entry_price, current_price, direction')
      .not('outcome', 'is', null);

    if (data) {
      const total = data.length;
      const wins = data.filter(s => {
        // Calculate actual P&L from prices
        if (s.entry_price && s.current_price) {
          const pnl = s.direction === 'long' 
            ? ((s.current_price - s.entry_price) / s.entry_price) * 100
            : ((s.entry_price - s.current_price) / s.entry_price) * 100;
          return pnl > 0;
        }
        // Fall back to stored data
        return s.hit_tp1 || s.hit_tp2 || s.hit_tp3 || s.outcome === 'profit' || (s.final_pnl_pct && s.final_pnl_pct > 0);
      }).length;
      const stopped = data.filter(s => s.hit_stop || s.outcome === 'stopped_out').length;
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
      <header className="border-b border-border sticky top-0 bg-background z-20">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-3 sm:py-4">
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

      <main className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <SignalPerformanceSummary 
          stats={signalStats} 
          onClick={() => setShowTrackRecord(true)}
        />
        
        <div className="flex gap-1.5 sm:gap-2 mb-4 sm:mb-6 overflow-x-auto pb-1">
          {(['all', 'strong', 'long', 'short'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 sm:px-3 py-1.5 text-[10px] sm:text-sm rounded-md transition-colors whitespace-nowrap ${
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
            <CardContent className="py-8 sm:py-12 text-center">
              <h3 className="text-base sm:text-lg font-medium mb-2">No Active Signals</h3>
              <p className="text-muted-foreground text-xs sm:text-sm">
                Signals appear when elite traders open positions or multiple quality traders converge.
              </p>
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
    </div>
  );
}