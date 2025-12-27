'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCurrency } from '@hyperliquid-tracker/shared';

interface WalletChartProps {
  address: string;
}

interface ChartData {
  date: string;
  pnl: number;
}

export function WalletChart({ address }: WalletChartProps) {
  const [data, setData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();
      
      // Fetch trades with closed PnL
      const { data: trades, error } = await supabase
        .from('trades')
        .select('timestamp, closed_pnl')
        .eq('wallet', address)
        .not('closed_pnl', 'is', null)
        .order('timestamp', { ascending: true })
        .limit(500);

      if (error) {
        console.error('Error fetching chart data:', error);
        setLoading(false);
        return;
      }

      // Aggregate by day
      const dailyPnl: Record<string, number> = {};
      let cumulative = 0;

      for (const trade of trades || []) {
        const date = new Date(trade.timestamp).toISOString().split('T')[0];
        cumulative += trade.closed_pnl || 0;
        dailyPnl[date] = cumulative;
      }

      const chartData = Object.entries(dailyPnl).map(([date, pnl]) => ({
        date,
        pnl,
      }));

      setData(chartData);
      setLoading(false);
    }

    fetchData();
  }, [address]);

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground">
        Loading chart...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground">
        No PnL data available
      </div>
    );
  }

  const lastPnl = data[data.length - 1]?.pnl || 0;
  const isPositive = lastPnl >= 0;

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <XAxis 
            dataKey="date" 
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          />
          <YAxis 
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={(value) => formatCurrency(value, { compact: true })}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
            }}
            labelFormatter={(value) => new Date(value).toLocaleDateString()}
            formatter={(value: number) => [formatCurrency(value), 'Cumulative PnL']}
          />
          <Line
            type="monotone"
            dataKey="pnl"
            stroke={isPositive ? '#22c55e' : '#ef4444'}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
