'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface NavLinkProps {
  href: string;
  icon: LucideIcon;
  children: ReactNode;
  external?: boolean;
}

export function NavLink({ href, icon: Icon, children, external }: NavLinkProps): ReactElement {
  const pathname = usePathname();
  const active = !external && (pathname === href || (href !== '/' && pathname.startsWith(href)));

  const className = cn(
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
    active
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
  );

  if (external) {
    return (
      <a href={href} className={className} target="_blank" rel="noreferrer noopener">
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span>{children}</span>
      </a>
    );
  }

  return (
    <Link
      href={href}
      className={className}
      aria-current={active ? 'page' : undefined}
      data-active={active ? 'true' : 'false'}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{children}</span>
    </Link>
  );
}
