'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import type { ReactElement } from 'react';

export interface ThemeToggleProps {
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * Compact button that toggles light ↔ dark.
 * Renders nothing on the server to avoid the hydration flash before
 * next-themes resolves the user/system preference.
 */
export function ThemeToggle({ className, size = 'md' }: ThemeToggleProps): ReactElement | null {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Reserve the same footprint so layout doesn't shift on hydration.
    const placeholder = size === 'sm' ? 'inline-block h-6 w-6' : 'inline-block h-7 w-7';
    return <span aria-hidden="true" className={`${placeholder} ${className ?? ''}`} />;
  }

  const isDark = resolvedTheme === 'dark';
  const next = isDark ? 'light' : 'dark';
  const Icon = isDark ? Sun : Moon;
  const sizeClasses = size === 'sm' ? 'h-6 w-6 rounded-[6px]' : 'h-7 w-7 rounded-[7px]';
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-[15px] w-[15px]';

  return (
    <button
      type="button"
      onClick={(): void => setTheme(next)}
      title={isDark ? 'Comută la light mode' : 'Comută la dark mode'}
      aria-label={isDark ? 'Activează light mode' : 'Activează dark mode'}
      data-testid="theme-toggle"
      className={`flex shrink-0 items-center justify-center text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 ${sizeClasses} ${className ?? ''}`}
    >
      <Icon className={iconSize} aria-hidden="true" />
    </button>
  );
}
