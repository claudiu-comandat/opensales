import { z } from 'zod';

/**
 * Helper care produce o schemă Zod pentru credențialele plugin-ului
 * și un type util pentru `onConfigure`.
 *
 * Plugin-ul declară:
 *
 *   const SecretSchema = defineSecretSchema({
 *     apiKey: z.string().min(1),
 *     apiSecret: z.string().min(1),
 *   });
 *   type Secrets = z.infer<typeof SecretSchema>;
 *
 *   plugin.onConfigure = async (raw) => {
 *     const secrets = SecretSchema.parse(raw);
 *     await ctx.secrets.set('apiKey', secrets.apiKey);
 *     // ...
 *   };
 */
export function defineSecretSchema<T extends z.ZodRawShape>(shape: T): z.ZodObject<T> {
  return z.object(shape);
}
