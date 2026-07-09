import type { z } from 'zod';

export interface ActionHandler<I, O> {
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  handle: (input: I) => Promise<O>;
}

export type ActionHandlerMap = Record<string, ActionHandler<unknown, unknown>>;
