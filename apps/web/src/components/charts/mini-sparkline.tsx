'use client';

import { LineChart, Line, ResponsiveContainer } from 'recharts';

interface MiniSparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: 'auto' | 'green' | 'red' | 'blue';
}

export function MiniSparkline({
  data,
  width = 80,
  height = 24,
  color = 'auto',
}: MiniSparklineProps) {
  if (data.length < 2) {
    return <div style={{ width, height }} />;
  }

  const chartData = data.map((value, index) => ({ index, value }));
  
  // Determine color based on trend
  let strokeColor = '#3b82f6'; // blue
  if (color === 'auto') {
    const trend = data[data.length - 1] - data[0];
    strokeColor = trend >= 0 ? '#22c55e' : '#ef4444';
  } else if (color === 'green') {
    strokeColor = '#22c55e';
  } else if (color === 'red') {
    strokeColor = '#ef4444';
  }

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={strokeColor}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
