import { z } from 'zod';

import type { ActionHandlerMap, PluginLogger } from '@opensales/plugin-sdk';

const orderCreatedPayloadSchema = z
  .object({
    orderId: z.string().optional(),
    id: z.string().optional(),
    order_id: z.string().optional(),
  })
  .passthrough();

function extractOrderId(payload: unknown): string | null {
  const res = orderCreatedPayloadSchema.safeParse(payload);
  if (!res.success) return null;
  return res.data.orderId ?? res.data.id ?? res.data.order_id ?? null;
}

export interface AutoEmitDeps {
  /** Funcție lazy care întoarce flag-ul curent. Reevaluat la fiecare event. */
  isEnabled: () => boolean;
  /** Action map din care extragem `emitInvoice` la momentul evenimentului. */
  getActions: () => ActionHandlerMap | null;
  logger: () => PluginLogger | null;
}

/**
 * Handler pentru `order.created`. Dacă `autoEmitOnOrderCreated=true`, apelează
 * acțiunea `emitInvoice` pentru order-ul nou creat.
 *
 * Failure-urile NU bubble-up — sunt logate. Crearea order-ului nu se blochează
 * dacă FGO refuză emiterea (operatorul poate retrimite manual).
 */
export function buildOnOrderCreated(deps: AutoEmitDeps): (payload: unknown) => Promise<void> {
  return async (payload: unknown) => {
    const logger = deps.logger();
    if (!deps.isEnabled()) {
      logger?.debug('FGO auto-emit disabled, ignoring order.created');
      return;
    }
    const orderId = extractOrderId(payload);
    if (!orderId) {
      logger?.warn('FGO auto-emit: missing orderId in payload', { payload });
      return;
    }
    const actions = deps.getActions();
    const emit = actions?.emitInvoice;
    if (!emit) {
      logger?.error('FGO auto-emit: emitInvoice action not registered');
      return;
    }
    try {
      const input = emit.input.parse({ orderId });
      await emit.handle(input);
      logger?.info('FGO auto-emit: invoice issued', { orderId });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger?.error('FGO auto-emit failed', { orderId, reason });
    }
  };
}
