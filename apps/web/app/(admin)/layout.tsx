import type { ReactElement, ReactNode } from 'react';

import { Sidebar } from '@/components/Sidebar';

export default function AdminLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <div
      className="flex w-full overflow-hidden text-ink-900"
      style={{ height: 'calc(100vh / 0.75)' }}
    >
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-auto px-[30px] pb-[60px] pt-[26px]">{children}</main>
      </div>
    </div>
  );
}
