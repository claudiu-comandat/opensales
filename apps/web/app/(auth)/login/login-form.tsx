'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

const schema = z.object({
  email: z.string().email('Email invalid'),
  password: z.string().min(1, 'Parolă obligatorie'),
});
type FormValues = z.infer<typeof schema>;

export default function LoginForm(): ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: FormValues): Promise<void> {
    setError(null);
    try {
      await getApiClient().post('/auth/login', values);
      const redirectTo = params.get('next') ?? params.get('redirect') ?? '/';
      router.push(redirectTo);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError('Email sau parolă incorecte');
      } else {
        setError('Eroare la autentificare. Încearcă din nou.');
      }
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Autentificare OpenSales</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            void form.handleSubmit(onSubmit)(e);
          }}
          className="space-y-4"
          noValidate
        >
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              {...form.register('email')}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
            {form.formState.errors.email && (
              <p className="text-sm text-destructive mt-1">{form.formState.errors.email.message}</p>
            )}
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1">
              Parolă
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              {...form.register('password')}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
            {form.formState.errors.password && (
              <p className="text-sm text-destructive mt-1">
                {form.formState.errors.password.message}
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
            {form.formState.isSubmitting ? 'Se autentifică…' : 'Autentificare'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
