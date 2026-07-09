import { redirect } from 'next/navigation';

import LoginForm from './login-form';

import type { ReactElement } from 'react';

import { fetchMe } from '@/lib/auth';

export default async function LoginPage(): Promise<ReactElement> {
  const me = await fetchMe();
  if (me) redirect('/');
  return <LoginForm />;
}
