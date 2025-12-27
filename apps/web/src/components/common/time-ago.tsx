'use client';

import { useEffect, useState } from 'react';
import { timeAgo } from '@hyperliquid-tracker/shared';

interface TimeAgoProps {
  date: string | Date;
}

export function TimeAgo({ date }: TimeAgoProps) {
  const [display, setDisplay] = useState(() => timeAgo(new Date(date)));

  useEffect(() => {
    const interval = setInterval(() => {
      setDisplay(timeAgo(new Date(date)));
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [date]);

  return (
    <span className="text-muted-foreground" title={new Date(date).toLocaleString()}>
      {display}
    </span>
  );
}
