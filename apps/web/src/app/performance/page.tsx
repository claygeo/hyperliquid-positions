'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================
// Types
// ============================================

interface SignalOutcome {
  id: number;
  signal_id: number;
  coin: string;
  direction: string;
  entry_price: number;
  exit_price: number | null;
  entry_time: string;
  exit_time: string | null;
  exit_reason: string | null;
  current_price: number;
  current_pnl_pct: number;
  final_pnl_pct: number | null;
  max_profit_pct: number;
  max_drawdown_pct: number;
  duration_hours: number | null;
  hit_stop: boolean;
  hit_target_1: boolean;
  hit_target_2: boolean;
  hit_target_3: boolean;
  entry_elite_count: number;
  entry_good_count: number;
  entry_confidence: number;
  is_active: boolean;
}

interface AssetPerformance {
  coin: string;
  total_signals: number;
  winning_signals: number;
  losing_signals: number;
  avg_pnl_pct: number;
  total_pnl_pct: number;
  win_rate: number;
  avg_duration_hours: number;
  best_signal_pnl_pct: number;
  worst_signal_pnl_pct: number;
  last_signal_at: string;
}

interface PerformanceSummary {
  totalSignals: number;
  activeSignals: number;
  closedSignals: number;
  winningSignals: number;
  losingSignals: number;
  winRate: number;
  avgPnlPct: number;
  totalPnlPct: number;
  avgDuration: number;
  bestSignal: { coin: string; pnl: number } | null;
  worstSignal: { coin: string; pnl: number } | null;
}

// ============================================
// Helper Functions
// ============================================

function formatPnl(pnl: number | null): string {
  if (pnl === null) return '-';
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}${pnl.toFixed(2)}%`;
}

function formatPrice(price: number | null): string {
  if (price === null) return '-';
  if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(6)}`;
}

function formatDuration(hours: number | null): string {
  if (hours === null) return '-';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getExitReasonLabel(reason: string | null): string {
  switch (reason) {
    case 'traders_exited': return 'Traders Exited';
    case 'stop_hit': return 'Stop Hit';
    case 'target_hit': return 'Target Hit';
    case 'expired': return 'Expired';
    case 'invalidated': return 'Invalidated';
    default: return reason || '-';
  }
}

// ============================================
// Components
// ============================================

function StatCard({ title, value, subValue, color = 'gray' }: { 
  title: string; 
  value: string | number; 
  subValue?: string;
  color?: 'gray' | 'green' | 'red' | 'blue' | 'yellow';
}) {
  const colorClasses = {
    gray: 'bg-gray-800 border-gray-700',
    green: 'bg-green-900/30 border-green-700',
    red: 'bg-red-900/30 border-red-700',
    blue: 'bg-blue-900/30 border-blue-700',
    yellow: 'bg-yellow-900/30 border-yellow-700',
  };
  
  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <div className="text-sm text-gray-400 mb-1">{title}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {subValue && <div className="text-xs text-gray-500 mt-1">{subValue}</div>}
    </div>
  );
}

function SignalRow({ signal, isActive }: { signal: SignalOutcome; isActive: boolean }) {
  const pnl = isActive ? signal.current_pnl_pct : signal.final_pnl_pct;
  const isWin = (pnl || 0) > 0;
  
  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/50">
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white">{signal.coin}</span>
          <span className={`text-xs px-2 py-0.5 rounded ${
            signal.direction === 'long' 
              ? 'bg-green-900/50 text-green-400' 
              : 'bg-red-900/50 text-red-400'
          }`}>
            {signal.direction.toUpperCase()}
          </span>
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {signal.entry_elite_count}E + {signal.entry_good_count}G | {signal.entry_confidence}% conf
        </div>
      </td>
      <td className="py-3 px-4 text-gray-300">
        {formatPrice(signal.entry_price)}
      </td>
      <td className="py-3 px-4 text-gray-300">
        {isActive ? formatPrice(signal.current_price) : formatPrice(signal.exit_price)}
      </td>
      <td className={`py-3 px-4 font-medium ${isWin ? 'text-green-400' : 'text-red-400'}`}>
        {formatPnl(pnl)}
      </td>
      <td className="py-3 px-4">
        <div className="text-green-400 text-sm">{formatPnl(signal.max_profit_pct)}</div>
        <div className="text-red-400 text-sm">{formatPnl(signal.max_drawdown_pct)}</div>
      </td>
      <td className="py-3 px-4 text-gray-300">
        {isActive 
          ? formatDuration((Date.now() - new Date(signal.entry_time).getTime()) / (1000 * 60 * 60))
          : formatDuration(signal.duration_hours)
        }
      </td>
      <td className="py-3 px-4">
        {isActive ? (
          <span className="text-xs px-2 py-1 rounded bg-blue-900/50 text-blue-400">
            TRACKING
          </span>
        ) : (
          <span className={`text-xs px-2 py-1 rounded ${
            isWin ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
          }`}>
            {isWin ? '✓ WIN' : '✗ LOSS'}
          </span>
        )}
      </td>
      <td className="py-3 px-4 text-gray-400 text-sm">
        {isActive ? formatDate(signal.entry_time) : getExitReasonLabel(signal.exit_reason)}
      </td>
    </tr>
  );
}

function AssetRow({ asset }: { asset: AssetPerformance }) {
  const isPositive = asset.avg_pnl_pct > 0;
  
  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/50">
      <td className="py-3 px-4 font-medium text-white">{asset.coin}</td>
      <td className="py-3 px-4 text-gray-300">{asset.total_signals}</td>
      <td className="py-3 px-4">
        <span className="text-green-400">{asset.winning_signals}</span>
        <span className="text-gray-500"> / </span>
        <span className="text-red-400">{asset.losing_signals}</span>
      </td>
      <td className="py-3 px-4">
        <span className={isPositive ? 'text-green-400' : 'text-red-400'}>
          {(asset.win_rate * 100).toFixed(0)}%
        </span>
      </td>
      <td className={`py-3 px-4 font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
        {formatPnl(asset.avg_pnl_pct)}
      </td>
      <td className={`py-3 px-4 ${asset.total_pnl_pct > 0 ? 'text-green-400' : 'text-red-400'}`}>
        {formatPnl(asset.total_pnl_pct)}
      </td>
      <td className="py-3 px-4 text-gray-300">
        {formatDuration(asset.avg_duration_hours)}
      </td>
      <td className="py-3 px-4">
        <span className="text-green-400 text-sm">{formatPnl(asset.best_signal_pnl_pct)}</span>
        <span className="text-gray-500"> / </span>
        <span className="text-red-400 text-sm">{formatPnl(asset.worst_signal_pnl_pct)}</span>
      </td>
    </tr>
  );
}

// ============================================
// Main Page Component
// ============================================

export default function PerformancePage() {
  const [activeSignals, setActiveSignals] = useState<SignalOutcome[]>([]);
  const [closedSignals, setClosedSignals] = useState<SignalOutcome[]>([]);
  const [assetPerformance, setAssetPerformance] = useState<AssetPerformance[]>([]);
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'closed' | 'assets'>('active');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    try {
      // Fetch active signals
      const { data: active, error: activeError } = await supabase
        .from('signal_outcomes')
        .select('*')
        .eq('is_active', true)
        .order('current_pnl_pct', { ascending: false });
      
      if (activeError) throw activeError;
      
      // Fetch closed signals
      const { data: closed, error: closedError } = await supabase
        .from('signal_outcomes')
        .select('*')
        .eq('is_active', false)
        .not('final_pnl_pct', 'is', null)
        .order('exit_time', { ascending: false })
        .limit(100);
      
      if (closedError) throw closedError;
      
      // Fetch asset performance
      const { data: assets, error: assetsError } = await supabase
        .from('asset_performance')
        .select('*')
        .gt('total_signals', 0)
        .order('avg_pnl_pct', { ascending: false });
      
      if (assetsError) throw assetsError;
      
      setActiveSignals(active || []);
      setClosedSignals(closed || []);
      setAssetPerformance(assets || []);
      
      // Calculate summary
      const allClosed = closed || [];
      const winners = allClosed.filter(s => (s.final_pnl_pct || 0) > 0);
      const totalPnl = allClosed.reduce((sum, s) => sum + (s.final_pnl_pct || 0), 0);
      const totalDuration = allClosed.reduce((sum, s) => sum + (s.duration_hours || 0), 0);
      
      const sorted = [...allClosed].sort((a, b) => (b.final_pnl_pct || 0) - (a.final_pnl_pct || 0));
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      
      setSummary({
        totalSignals: (active?.length || 0) + allClosed.length,
        activeSignals: active?.length || 0,
        closedSignals: allClosed.length,
        winningSignals: winners.length,
        losingSignals: allClosed.length - winners.length,
        winRate: allClosed.length > 0 ? winners.length / allClosed.length : 0,
        avgPnlPct: allClosed.length > 0 ? totalPnl / allClosed.length : 0,
        totalPnlPct: totalPnl,
        avgDuration: allClosed.length > 0 ? totalDuration / allClosed.length : 0,
        bestSignal: best ? { coin: `${best.coin} ${best.direction.toUpperCase()}`, pnl: best.final_pnl_pct || 0 } : null,
        worstSignal: worst && allClosed.length > 0 ? { coin: `${worst.coin} ${worst.direction.toUpperCase()}`, pnl: worst.final_pnl_pct || 0 } : null,
      });
      
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error('Failed to fetch performance data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white p-8">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-800 rounded w-64 mb-8"></div>
            <div className="grid grid-cols-4 gap-4 mb-8">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-24 bg-gray-800 rounded"></div>
              ))}
            </div>
            <div className="h-64 bg-gray-800 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">Signal Performance</h1>
            <p className="text-gray-400 mt-1">Track and analyze signal outcomes</p>
          </div>
          <div className="text-right">
            <button 
              onClick={fetchData}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition"
            >
              Refresh
            </button>
            <div className="text-xs text-gray-500 mt-2">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-400">
            {error}
          </div>
        )}

        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
            <StatCard 
              title="Active Signals" 
              value={summary.activeSignals}
              subValue="Currently tracking"
              color="blue"
            />
            <StatCard 
              title="Closed Signals" 
              value={summary.closedSignals}
              subValue={`${summary.winningSignals}W / ${summary.losingSignals}L`}
              color="gray"
            />
            <StatCard 
              title="Win Rate" 
              value={summary.closedSignals > 0 ? `${(summary.winRate * 100).toFixed(1)}%` : '-'}
              subValue={summary.closedSignals > 0 ? `${summary.winningSignals} winners` : 'No closed signals yet'}
              color={summary.winRate >= 0.5 ? 'green' : summary.closedSignals > 0 ? 'red' : 'gray'}
            />
            <StatCard 
              title="Avg P&L" 
              value={summary.closedSignals > 0 ? formatPnl(summary.avgPnlPct) : '-'}
              subValue="Per signal"
              color={summary.avgPnlPct > 0 ? 'green' : summary.closedSignals > 0 ? 'red' : 'gray'}
            />
            <StatCard 
              title="Total P&L" 
              value={summary.closedSignals > 0 ? formatPnl(summary.totalPnlPct) : '-'}
              subValue="All closed signals"
              color={summary.totalPnlPct > 0 ? 'green' : summary.closedSignals > 0 ? 'red' : 'gray'}
            />
            <StatCard 
              title="Avg Duration" 
              value={summary.closedSignals > 0 ? formatDuration(summary.avgDuration) : '-'}
              subValue="Hold time"
              color="gray"
            />
          </div>
        )}

        {/* Best/Worst Signals */}
        {summary && summary.closedSignals > 0 && (
          <div className="grid grid-cols-2 gap-4 mb-8">
            {summary.bestSignal && (
              <div className="p-4 bg-green-900/20 border border-green-800 rounded-lg">
                <div className="text-sm text-green-400 mb-1">Best Signal</div>
                <div className="text-xl font-bold text-white">{summary.bestSignal.coin}</div>
                <div className="text-2xl font-bold text-green-400">{formatPnl(summary.bestSignal.pnl)}</div>
              </div>
            )}
            {summary.worstSignal && (
              <div className="p-4 bg-red-900/20 border border-red-800 rounded-lg">
                <div className="text-sm text-red-400 mb-1">Worst Signal</div>
                <div className="text-xl font-bold text-white">{summary.worstSignal.coin}</div>
                <div className="text-2xl font-bold text-red-400">{formatPnl(summary.worstSignal.pnl)}</div>
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('active')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              activeTab === 'active'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Active ({activeSignals.length})
          </button>
          <button
            onClick={() => setActiveTab('closed')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              activeTab === 'closed'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Closed ({closedSignals.length})
          </button>
          <button
            onClick={() => setActiveTab('assets')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              activeTab === 'assets'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            By Asset ({assetPerformance.length})
          </button>
        </div>

        {/* Tables */}
        <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
          {activeTab === 'active' && (
            <>
              {activeSignals.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                  No active signals being tracked
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-800/50">
                      <tr>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Signal</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Entry</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Current</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">P&L</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Max/DD</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Duration</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Status</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Opened</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeSignals.map(signal => (
                        <SignalRow key={signal.id} signal={signal} isActive={true} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {activeTab === 'closed' && (
            <>
              {closedSignals.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                  <div className="text-xl mb-2">No closed signals yet</div>
                  <div className="text-sm">Signals will appear here once traders exit their positions</div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-800/50">
                      <tr>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Signal</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Entry</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Exit</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">P&L</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Max/DD</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Duration</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Result</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Exit Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closedSignals.map(signal => (
                        <SignalRow key={signal.id} signal={signal} isActive={false} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {activeTab === 'assets' && (
            <>
              {assetPerformance.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                  <div className="text-xl mb-2">No asset performance data yet</div>
                  <div className="text-sm">Data will appear after signals close</div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-800/50">
                      <tr>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Asset</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Signals</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">W/L</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Win Rate</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Avg P&L</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Total P&L</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Avg Duration</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Best/Worst</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assetPerformance.map(asset => (
                        <AssetRow key={asset.coin} asset={asset} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer note */}
        <div className="mt-6 text-center text-sm text-gray-500">
          Signals close when: traders exit positions, stop loss hit, or after 7 days max
        </div>
      </div>
    </div>
  );
}