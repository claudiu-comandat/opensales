import { type ReactElement } from 'react';

import { ProductForm } from '../product-form.js';

export const dynamic = 'force-dynamic';

export default function NewProductPage(): ReactElement {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="t-h1">Produs nou</h1>
        <p className="t-small mt-1">Adaugă un produs nou în catalog.</p>
      </div>
      <ProductForm mode="create" />
    </div>
  );
}
