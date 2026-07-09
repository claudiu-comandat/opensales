import { type ActionHandler, type ActionHandlerMap } from '@opensales/plugin-sdk';
import { z } from 'zod';

import { type FgoClientProvider } from '../client.js';

const emptyInput = z.object({}).strict();

const nomenclatureOutput = z.object({
  items: z.array(
    z.object({
      Cod: z.string(),
      Denumire: z.string(),
    }),
  ),
});

function makeNomenclatureHandler(
  provider: FgoClientProvider,
  tip: string,
): ActionHandler<unknown, unknown> {
  const handler: ActionHandler<z.infer<typeof emptyInput>, z.infer<typeof nomenclatureOutput>> = {
    input: emptyInput,
    output: nomenclatureOutput,
    handle: async () => {
      const client = await provider();
      const items = await client.getNomenclature(tip);
      return { items };
    },
  };
  return handler as unknown as ActionHandler<unknown, unknown>;
}

/**
 * Construiește harta de action-handlers pentru nomenclatoarele FGO.
 * Aceste apeluri NU sunt autentificate — FGO le servește public.
 *
 * Pentru MVP fără cache; latența e ~200ms și volumele sunt mici.
 * O ediție viitoare poate adăuga cache cu TTL 24h în PluginSecretStorage.
 */
export function buildNomenclatureActions(provider: FgoClientProvider): ActionHandlerMap {
  return {
    listCountries: makeNomenclatureHandler(provider, 'tara'),
    listCounties: makeNomenclatureHandler(provider, 'judet'),
    listVatRates: makeNomenclatureHandler(provider, 'tva'),
    listCurrencies: makeNomenclatureHandler(provider, 'valuta'),
    listInvoiceTypes: makeNomenclatureHandler(provider, 'tipfactura'),
    listPaymentTypes: makeNomenclatureHandler(provider, 'tipincasare'),
  };
}
