import { type ReactElement } from 'react';

import { OrderForm } from '../order-form.js';

export const dynamic = 'force-dynamic';

export default function NewOrderPage(): ReactElement {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="t-h1">Comandă nouă</h1>
        <p className="t-small mt-1">
          Creează manual o comandă. În flux normal, comenzile vin sincronizate prin pluginurile
          conectate (eMag, Shopify, etc.).
        </p>
      </div>
      <OrderForm />
    </div>
  );
}
