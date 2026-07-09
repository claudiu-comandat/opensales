import { z } from 'zod';

/**
 * Definiția unei acțiuni expuse de plugin către platformă.
 * Folosită ca metadata în manifest. Implementarea concretă (handler-ul)
 * e furnizată în `definePlugin({ actions: { ... } })`.
 */
export interface ActionDefinition<I = unknown, O = unknown> {
  description?: string | undefined;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
}

export const actionDefinitionShape = z.object({
  description: z.string().optional(),
  /**
   * Pentru manifest serializat, schemele Zod sunt reprezentate ca obiecte JSON Schema-like.
   * SDK-ul însă păstrează ZodType-urile la runtime. La validarea manifestului
   * acceptăm `unknown` aici și verificăm structura când plugin-ul e încărcat.
   */
  input: z.unknown(),
  output: z.unknown(),
});

export type ActionsRecord = Record<string, ActionDefinition>;
