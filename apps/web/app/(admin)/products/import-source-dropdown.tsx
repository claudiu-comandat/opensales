'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { EasysalesImportDialog } from './easysales-import-dialog.js';
import { EmagImportDialog } from './emag-import-dialog.js';
import { TrendyolImportDialog } from './trendyol-import-dialog.js';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';

const EMAG_PACKAGE_NAME = '@opensales-plugin/emag';
const TRENDYOL_PACKAGE_NAME = '@opensales-plugin/trendyol';

export type PluginStatus = 'pending_verification' | 'active' | 'error' | 'disabled';

export interface ImportSourcePlugin {
  id: string;
  packageName: string;
  displayName?: string;
  status: PluginStatus;
}

interface ImportSourceDropdownProps {
  plugins: ImportSourcePlugin[];
  onImported: () => void;
}

export function ImportSourceDropdown({
  plugins,
  onImported,
}: ImportSourceDropdownProps): ReactElement {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [easySalesOpen, setEasySalesOpen] = useState(false);
  const [emagOpen, setEmagOpen] = useState(false);
  const [trendyolOpen, setTrendyolOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const emagPlugin = plugins.find((p) => p.packageName === EMAG_PACKAGE_NAME);
  const trendyolPlugin = plugins.find((p) => p.packageName === TRENDYOL_PACKAGE_NAME);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent): void {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return (): void => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  function handleEasySalesClick(): void {
    setMenuOpen(false);
    setEasySalesOpen(true);
  }

  function handleEmagClick(): void {
    if (!emagPlugin) return;
    setMenuOpen(false);
    if (emagPlugin.status === 'active') {
      setEmagOpen(true);
    } else {
      router.push(`/plugins/${emagPlugin.id}`);
    }
  }

  function handleTrendyolClick(): void {
    if (!trendyolPlugin) return;
    setMenuOpen(false);
    if (trendyolPlugin.status === 'active') {
      setTrendyolOpen(true);
    } else {
      router.push(`/plugins/${trendyolPlugin.id}`);
    }
  }

  return (
    <>
      <div ref={containerRef} className="relative">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(): void => setMenuOpen((v) => !v)}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Importă din...
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="ml-1"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </Button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 z-40 mt-1 w-56 overflow-hidden rounded-[12px] border border-ink-200 bg-surface py-1 shadow-os-sm"
          >
            <button
              type="button"
              role="menuitem"
              onClick={handleEasySalesClick}
              className="block w-full px-3 py-2 text-left text-[13px] text-ink-700 hover:bg-ink-50"
            >
              EasySales (XLSX)
            </button>
            {emagPlugin && (
              <button
                type="button"
                role="menuitem"
                onClick={handleEmagClick}
                className="block w-full px-3 py-2 text-left text-[13px] text-ink-700 hover:bg-ink-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span>eMAG</span>
                  {emagPlugin.status !== 'active' && (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10.5px] font-medium text-warning">
                      Configurează
                    </span>
                  )}
                </div>
              </button>
            )}
            {trendyolPlugin && (
              <button
                type="button"
                role="menuitem"
                onClick={handleTrendyolClick}
                className="block w-full px-3 py-2 text-left text-[13px] text-ink-700 hover:bg-ink-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span>Trendyol</span>
                  {trendyolPlugin.status !== 'active' && (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10.5px] font-medium text-warning">
                      Configurează
                    </span>
                  )}
                </div>
              </button>
            )}
          </div>
        )}
      </div>
      {easySalesOpen && (
        <EasysalesImportDialog
          onClose={(): void => setEasySalesOpen(false)}
          onSuccess={onImported}
        />
      )}
      {emagOpen && (
        <EmagImportDialog
          open={emagOpen}
          onClose={(): void => setEmagOpen(false)}
          onSuccess={onImported}
        />
      )}
      {trendyolOpen && (
        <TrendyolImportDialog
          open={trendyolOpen}
          onClose={(): void => setTrendyolOpen(false)}
          onSuccess={onImported}
        />
      )}
    </>
  );
}
