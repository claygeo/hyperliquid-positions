'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { 
  Compass, 
  Eye, 
  Bell, 
  Settings,
  TrendingUp,
} from 'lucide-react';

const navItems = [
  { href: '/discover', label: 'Discover', icon: Compass },
  { href: '/watchlist', label: 'Watchlist', icon: Eye },
  { href: '/signals', label: 'Signals', icon: Bell },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-14 z-40 h-[calc(100vh-3.5rem)] w-64 border-r border-border bg-background hidden lg:block">
      <div className="flex flex-col h-full py-4">
        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Stats footer */}
        <div className="px-3 py-4 border-t border-border">
          <div className="rounded-lg bg-muted p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <TrendingUp className="h-4 w-4 text-success" />
              <span>Live Tracking</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Monitoring 1,234 wallets
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
