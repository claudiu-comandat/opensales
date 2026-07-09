import { InstallWizard } from './install-wizard';

import type { ReactElement } from 'react';

export const dynamic = 'force-dynamic';

export default function InstallPluginPage(): ReactElement {
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Instalează plugin</h1>
        <p className="text-sm text-muted-foreground">
          Adaugă un plugin dintr-un fișier tarball, repo GitHub sau pachet npm.
        </p>
      </div>
      <InstallWizard />
    </div>
  );
}
