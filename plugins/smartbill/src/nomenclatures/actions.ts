import { type ActionHandler, type ActionHandlerMap } from '@opensales/plugin-sdk';
import { z } from 'zod';

import { type SmartBillClientProvider } from '../client.js';

const emptyInput = z.object({}).strict();
const rawOutput = z.record(z.unknown());

/**
 * Construiește harta de action-handlers pentru nomenclatoarele SmartBill.
 * Acestea citesc cotele TVA (GET /tax) și seriile de documente (GET /series)
 * definite în contul Cloud — necesare pentru a valida `seriesName`/`taxName`
 * înainte de emitere.
 *
 * Pentru MVP fără cache; volumele sunt mici. O ediție viitoare poate adăuga
 * cache cu TTL în PluginSecretStorage.
 */
export function buildNomenclatureActions(provider: SmartBillClientProvider): ActionHandlerMap {
  const listVatRates: ActionHandler<z.infer<typeof emptyInput>, z.infer<typeof rawOutput>> = {
    input: emptyInput,
    output: rawOutput,
    handle: async () => {
      const client = await provider();
      return client.getTaxes();
    },
  };

  const listSeries: ActionHandler<z.infer<typeof emptyInput>, z.infer<typeof rawOutput>> = {
    input: emptyInput,
    output: rawOutput,
    handle: async () => {
      const client = await provider();
      return client.getSeries();
    },
  };

  return {
    listVatRates: listVatRates as unknown as ActionHandler<unknown, unknown>,
    listSeries: listSeries as unknown as ActionHandler<unknown, unknown>,
  };
}
