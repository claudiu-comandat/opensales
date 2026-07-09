'use client';

import {
  BookOpen,
  Box,
  Bug,
  ChevronsLeft,
  ChevronsRight,
  Layers,
  LogOut,
  Package,
  Settings,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { ThemeToggle } from '@/components/theme-toggle';
import { getApiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

export interface SidebarItem {
  href: string;
  label: string;
  icon: LucideIcon;
  external?: boolean;
}

export interface SidebarSection {
  title: string;
  items: readonly SidebarItem[];
}

const NAV_SECTIONS: readonly SidebarSection[] = [
  {
    title: 'Operațiuni',
    items: [
      { href: '/orders', label: 'Comenzi', icon: Box },
      { href: '/products', label: 'Produse', icon: Package },
    ],
  },
  {
    title: 'Ecosistem',
    items: [
      { href: '/plugins', label: 'Plugins', icon: Layers },
      { href: '/debug', label: 'Debug', icon: Bug },
    ],
  },
  {
    title: 'Cont',
    items: [
      { href: '/settings', label: 'Setări', icon: Settings },
      { href: '/rpc/api-docs', label: 'API Docs', icon: BookOpen, external: true },
    ],
  },
];

const NAV_ITEMS: readonly SidebarItem[] = NAV_SECTIONS.flatMap((s) => s.items);

export interface SidebarUser {
  email: string;
  organizationName?: string;
}

export interface SidebarProps {
  className?: string;
  user?: SidebarUser | null;
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ className, user }: SidebarProps): ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleLogout(): Promise<void> {
    setBusy(true);
    try {
      await getApiClient().post('/auth/logout');
    } catch {
      // ignore — still navigate to login
    } finally {
      setBusy(false);
      router.push('/login');
      router.refresh();
    }
  }

  const width = collapsed ? 'w-[68px]' : 'w-[244px]';
  const orgName = user?.organizationName ?? 'OpenSales';
  const orgInitial = orgName.charAt(0).toUpperCase();
  const userEmail = user?.email ?? '';

  return (
    <aside
      aria-label="Primary navigation"
      className={cn(
        'relative z-[5] flex h-full shrink-0 flex-col p-[10px] transition-[width] duration-200 ease-out',
        width,
        className,
      )}
    >
      <div className="glass flex h-full flex-col overflow-hidden rounded-[18px] p-[10px]">
        {/* Logo + collapse toggle */}
        <div
          className={cn(
            'flex items-center pb-[14px] pt-2',
            collapsed ? 'justify-center px-0' : 'justify-start gap-[10px] px-[6px]',
          )}
        >
          <span className="brand-mark">O</span>
          {!collapsed && (
            <>
              <span className="flex-1 text-[15px] font-semibold tracking-[-0.02em] text-ink-900">
                OpenSales
              </span>
              <button
                type="button"
                onClick={(): void => setCollapsed(true)}
                title="Colapsează"
                aria-label="Collapse sidebar"
                className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] text-ink-600 transition-colors hover:bg-ink-100"
              >
                <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        {collapsed && (
          <button
            type="button"
            onClick={(): void => setCollapsed(false)}
            title="Extinde"
            aria-label="Expand sidebar"
            className="mx-auto mb-2 flex h-8 w-9 items-center justify-center rounded-[8px] text-ink-600 transition-colors hover:bg-ink-100"
          >
            <ChevronsRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        {/* Nav */}
        <nav
          aria-label="Sidebar navigation"
          className="flex flex-1 flex-col gap-[14px] overflow-y-auto overflow-x-hidden"
        >
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              {!collapsed && (
                <div className="mb-1.5 px-[10px] text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
                  {section.title}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const active = !item.external && isActive(pathname, item.href);
                  const Icon = item.icon;
                  const linkClass = cn(
                    'flex items-center rounded-[10px] text-[13.5px] font-medium transition-colors',
                    collapsed
                      ? 'mx-auto h-10 w-11 justify-center gap-0 p-0'
                      : 'h-auto w-full justify-start gap-[10px] px-[10px] py-2',
                    active
                      ? 'bg-ink-900 text-white shadow-[0_4px_12px_-4px_rgba(11,13,18,0.3)]'
                      : 'text-ink-700 hover:bg-ink-100',
                  );
                  if (item.external === true) {
                    return (
                      <a
                        key={item.href}
                        href={item.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        title={collapsed ? item.label : undefined}
                        className={linkClass}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                        {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
                      </a>
                    );
                  }
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={linkClass}
                      aria-current={active ? 'page' : undefined}
                      data-active={active ? 'true' : 'false'}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                      {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer: organization account + logout */}
        <div className="mt-[10px] border-t border-ink-200 pt-[10px]">
          <div
            className={cn(
              'flex items-center rounded-[10px] transition-colors',
              collapsed ? 'justify-center p-1.5' : 'justify-start gap-[10px] p-2',
            )}
          >
            <div
              className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] text-[12px] font-bold tracking-[-0.02em] text-white"
              style={{ background: 'linear-gradient(135deg, #FF8A3D, #E11D1D)' }}
              aria-hidden="true"
            >
              {orgInitial}
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[12.5px] font-medium text-ink-900">{orgName}</div>
                  {userEmail !== '' && (
                    <div className="truncate text-[11px] leading-[1.3] tracking-[0.02em] text-ink-500">
                      {userEmail}
                    </div>
                  )}
                </div>
                <ThemeToggle size="md" />
                <button
                  type="button"
                  onClick={(): void => {
                    void handleLogout();
                  }}
                  disabled={busy}
                  title="Logout"
                  aria-label="Logout"
                  data-testid="logout-button"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:opacity-50"
                >
                  <LogOut className="h-[15px] w-[15px]" aria-hidden="true" />
                </button>
              </>
            )}
            {collapsed && (
              <>
                <ThemeToggle size="sm" className="ml-1" />
                <button
                  type="button"
                  onClick={(): void => {
                    void handleLogout();
                  }}
                  disabled={busy}
                  title="Logout"
                  aria-label="Logout"
                  data-testid="logout-button"
                  className="ml-1 flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:opacity-50"
                >
                  <LogOut className="h-3 w-3" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

export { NAV_ITEMS, NAV_SECTIONS };
