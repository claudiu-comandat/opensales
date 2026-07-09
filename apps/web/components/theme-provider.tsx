'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

import type { ComponentProps, ReactElement } from 'react';

type Props = ComponentProps<typeof NextThemesProvider>;

export function ThemeProvider(props: Props): ReactElement {
  return <NextThemesProvider {...props} />;
}
