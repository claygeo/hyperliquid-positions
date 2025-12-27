'use client';

import { useState } from 'react';
import { shortenAddress } from '@hyperliquid-tracker/shared';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface AddressDisplayProps {
  address: string;
  full?: boolean;
  className?: string;
}

export function AddressDisplay({ address, full = false, className }: AddressDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayAddress = full ? address : shortenAddress(address);

  return (
    <span 
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-sm',
        className
      )}
    >
      <span>{displayAddress}</span>
      <button
        onClick={handleCopy}
        className="p-1 rounded hover:bg-muted transition-colors"
        title="Copy address"
      >
        {copied ? (
          <Check className="h-3 w-3 text-success" />
        ) : (
          <Copy className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
    </span>
  );
}
