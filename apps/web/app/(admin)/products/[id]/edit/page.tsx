import { notFound } from 'next/navigation';

import { ProductForm, type ProductFormInitial } from '../../product-form.js';

import type { ReactElement } from 'react';

import { ApiError } from '@/lib/api-types';
import { getServerApiClient } from '@/lib/server-api-client';

export const dynamic = 'force-dynamic';

interface EditProductPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage({
  params,
}: EditProductPageProps): Promise<ReactElement> {
  const { id } = await params;
  let product: ProductFormInitial;
  try {
    product = await (await getServerApiClient()).get<ProductFormInitial>(`/products/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      notFound();
    }
    throw e;
  }
  return (
    <div className="flex flex-col gap-4">
      <ProductForm mode="edit" initial={product} />
    </div>
  );
}
