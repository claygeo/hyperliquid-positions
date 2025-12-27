'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AddressDisplay } from '@/components/common/address-display';
import { WalletScore } from './wallet-score';
import { PriceChange } from '@/components/common/price-change';
import { TimeAgo } from '@/components/common/time-ago';
import { ArrowUpDown, Eye, EyeOff } from 'lucide-react';
import { formatNumber, formatCurrency } from '@hyperliquid-tracker/shared';

interface Wallet {
  address: string;
  total_trades: number;
  total_volume: number;
  win_rate: number | null;
  entry_score: number | null;
  overall_score: number | null;
  last_trade_at: string | null;
}

type SortField = 'overall_score' | 'win_rate' | 'entry_score' | 'total_volume' | 'total_trades';
type SortOrder = 'asc' | 'desc';

export function WalletTable() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('overall_score');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchWallets();
  }, [sortField, sortOrder]);

  async function fetchWallets() {
    setLoading(true);
    const supabase = createClient();
    
    const { data, error } = await supabase
      .from('wallets')
      .select('address, total_trades, total_volume, win_rate, entry_score, overall_score, last_trade_at')
      .gte('total_trades', 20)
      .not('overall_score', 'is', null)
      .order(sortField, { ascending: sortOrder === 'asc', nullsFirst: false })
      .limit(100);

    if (error) {
      console.error('Error fetching wallets:', error);
    } else {
      setWallets(data || []);
    }
    setLoading(false);
  }

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  }

  function toggleWatchlist(address: string) {
    setWatchlist(prev => {
      const next = new Set(prev);
      if (next.has(address)) {
        next.delete(address);
      } else {
        next.add(address);
      }
      return next;
    });
  }

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8 data-[state=open]:bg-accent"
      onClick={() => handleSort(field)}
    >
      {children}
      <ArrowUpDown className="ml-2 h-4 w-4" />
    </Button>
  );

  if (loading) {
    return <WalletTableSkeleton />;
  }

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12"></TableHead>
            <TableHead>Wallet</TableHead>
            <TableHead>
              <SortButton field="overall_score">Score</SortButton>
            </TableHead>
            <TableHead>
              <SortButton field="win_rate">Win Rate</SortButton>
            </TableHead>
            <TableHead>
              <SortButton field="entry_score">Entry Score</SortButton>
            </TableHead>
            <TableHead>
              <SortButton field="total_volume">Volume</SortButton>
            </TableHead>
            <TableHead>
              <SortButton field="total_trades">Trades</SortButton>
            </TableHead>
            <TableHead>Last Trade</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {wallets.map((wallet) => (
            <TableRow key={wallet.address}>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => toggleWatchlist(wallet.address)}
                >
                  {watchlist.has(wallet.address) ? (
                    <Eye className="h-4 w-4 text-primary" />
                  ) : (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </TableCell>
              <TableCell>
                <Link 
                  href={`/wallet/${wallet.address}`}
                  className="hover:underline"
                >
                  <AddressDisplay address={wallet.address} />
                </Link>
              </TableCell>
              <TableCell>
                <WalletScore score={wallet.overall_score} />
              </TableCell>
              <TableCell>
                {wallet.win_rate !== null ? (
                  <PriceChange value={wallet.win_rate} isPercent />
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell>
                {wallet.entry_score !== null ? (
                  <Badge variant={wallet.entry_score > 0 ? 'success' : wallet.entry_score < 0 ? 'danger' : 'secondary'}>
                    {(wallet.entry_score * 100).toFixed(1)}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatCurrency(wallet.total_volume, { compact: true })}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatNumber(wallet.total_trades)}
              </TableCell>
              <TableCell>
                {wallet.last_trade_at ? (
                  <TimeAgo date={wallet.last_trade_at} />
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function WalletTableSkeleton() {
  return (
    <div className="rounded-lg border border-border">
      <div className="animate-pulse">
        <div className="h-10 bg-muted" />
        {[...Array(10)].map((_, i) => (
          <div key={i} className="h-14 border-t border-border bg-card" />
        ))}
      </div>
    </div>
  );
}

export { WalletTableSkeleton };
