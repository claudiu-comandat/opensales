import { z } from 'zod';

/**
 * Medii FGO. Doc §0 Overview: PROD vs UAT (sandbox).
 */
export const FGO_ENVIRONMENTS = {
  prod: {
    label: 'FGO Production',
    apiUrl: 'https://api.fgo.ro/v1',
  },
  uat: {
    label: 'FGO UAT (sandbox)',
    apiUrl: 'https://api-testuat.fgo.ro/v1',
  },
} as const;

export type FgoEnvironment = keyof typeof FGO_ENVIRONMENTS;

/**
 * Schema secrets validată la onConfigure. Stocată criptat în /plugins/fgo/data/.
 *
 * `codUnic` + `privateKey` sunt credențialele de bază — fără ele clientul nu
 * poate semna nicio cerere autentificată.
 *
 * `environment` decide URL-ul (prod vs uat).
 *
 * `platformUrl`, `defaultSerie`, `autoEmitOnOrderCreated`, `verificareDuplicat`
 * sunt configurabile per instanță — toate trimise împreună cu secrets pentru
 * a păstra un singur "blob de configurare" la onConfigure.
 */
export const SecretSchema = z.object({
  codUnic: z.string().min(1, 'CodUnic (CUI) obligatoriu'),
  privateKey: z.string().min(1, 'Private Key FGO obligatoriu'),
  environment: z.enum(['prod', 'uat']).default('prod'),
  platformUrl: z.string().url().optional(),
  defaultSerie: z.string().min(1).optional(),
  autoEmitOnOrderCreated: z.boolean().default(false),
  verificareDuplicat: z.boolean().default(true),
});

export type FgoSecrets = z.infer<typeof SecretSchema>;

export function resolveApiUrl(env: FgoEnvironment): string {
  return FGO_ENVIRONMENTS[env].apiUrl;
}
