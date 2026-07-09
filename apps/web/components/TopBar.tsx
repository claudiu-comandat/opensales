'use client';

import { LogOut } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

export interface TopBarUser {
  email: string;
  role?: string;
}

export interface TopBarProps {
  user?: TopBarUser | null;
  className?: string;
}

function buildBreadcrumbs(pathname: string): readonly { label: string; href: string }[] {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; href: string }[] = [{ label: 'Home', href: '/' }];
  let current = '';
  for (const segment of segments) {
    current += `/${segment}`;
    const label = segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
    crumbs.push({ label, href: current });
  }
  return crumbs;
}

export function TopBar({ user, className }: TopBarProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const crumbs = buildBreadcrumbs(pathname);

  async function handleLogout(): Promise<void> {
    setBusy(true);
    try {
      await getApiClient().post('/auth/logout');
    } catch {
      // ignore — still navigate to login
    } finally {
      setBusy(false);
      setOpen(false);
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <header
      className={cn(
        'flex h-14 items-center justify-between border-b bg-background px-6',
        className,
      )}
    >
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
        <ol className="flex items-center gap-1 text-muted-foreground">
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;
            return (
              <li key={crumb.href} className="flex items-center gap-1">
                {index > 0 && <span aria-hidden="true">/</span>}
                <span
                  className={cn(isLast ? 'font-medium text-foreground' : '')}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {crumb.label}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          onClick={(): void => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid="user-menu-trigger"
        >
          {user?.email ?? 'Account'}
        </Button>
        {open && (
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {user && (
              <div className="border-b px-3 py-2 text-xs text-muted-foreground">
                <div className="truncate font-medium text-foreground">{user.email}</div>
                {user.role && <div className="capitalize">{user.role}</div>}
              </div>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={(): void => {
                void handleLogout();
              }}
              disabled={busy}
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
              data-testid="logout-button"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>Logout</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export { buildBreadcrumbs };
