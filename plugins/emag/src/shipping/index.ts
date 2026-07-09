import { z } from 'zod';

import type { ActionHandler } from '@opensales/plugin-sdk';

import { readAddresses } from './addresses.js';
import { saveAwbPackages } from './awb-package.js';
import { readAwb, readAwbPdf, saveAwb } from './awb.js';

import type { EmagClient } from '../client.js';
import type { EmagPlatformKey } from '../config.js';
import type {
  Address,
  AddressFilters,
  AwbPackageTemplate,
  AwbPdfFormat,
  AwbReadFilters,
  AwbReadItem,
  AwbSavePayload,
  AwbSaveResult,
} from './types.js';

export * from './types.js';
export * from './awb.js';
export * from './awb-package.js';
export * from './couriers.js';
export * from './localities.js';
export * from './addresses.js';

/* === Zod schemas pentru acțiuni === */

const awbPartySchema = z.object({
  name: z.string().min(3).max(255),
  contact: z.string().min(1).max(255),
  phone1: z.string().min(8).max(12),
  phone2: z.string().optional(),
  legal_entity: z.union([z.literal(0), z.literal(1)]).optional(),
  address_id: z.string().max(21).optional(),
  locality_id: z.number().int().min(1),
  street: z.string(),
  zipcode: z.string().optional(),
});

const awbPackageSchema = z.object({
  weight: z.number().min(0).max(99999),
  length: z.number().min(0).max(99999),
  width: z.number().min(0).max(99999),
  height: z.number().min(0).max(99999),
});

const awbPackageTemplateSchema = z.object({
  label: z.string().max(5),
  length: z.number().min(0).max(99999),
  width: z.number().min(0).max(99999),
  height: z.number().min(0).max(99999),
  weight: z.number().min(0).max(99999),
  is_default: z.boolean(),
});

const issueAwbInputSchema = z.object({
  order_id: z.number().int().optional(),
  rma_id: z.number().int().optional(),
  type: z.union([z.literal(1), z.literal(2)]).optional(),
  courier_account_id: z.number().int().optional(),
  sender: awbPartySchema,
  receiver: awbPartySchema,
  packages: z.array(awbPackageSchema).optional(),
  is_oversize: z.union([z.literal(0), z.literal(1)]).optional(),
  insured_value: z.number().min(0).optional(),
  weight: z.number().min(0).optional(),
  envelope_number: z.number().int().min(0).optional(),
  parcel_number: z.number().int().min(0).optional(),
  observation: z.string().max(255).optional(),
  locker_id: z.string().min(3).max(255).optional(),
  dropoff_locker: z.union([z.literal(0), z.literal(1)]).optional(),
  cod: z.number().min(0).optional(),
  pickup_and_return: z.union([z.literal(0), z.literal(1)]).optional(),
  unboxing: z.union([z.literal(0), z.literal(1)]).optional(),
  date: z.string().optional(),
  currency: z.string().length(3).optional(),
  /**
   * Platforma eMAG pe care se emite AWB-ul. Folosit de handler pentru a selecta
   * clientul API corect (emag-ro/emag-bg/emag-hu/fd-ro/fd-bg).
   * Nu este trimis către eMAG — e scos din payload înainte de apelul HTTP.
   */
  platform: z.string().optional(),
});

const awbBarcodeSchema = z.object({
  emag_id: z.number(),
  awb_barcode: z.string().optional(),
  awb_number: z.string().optional(),
  barcode: z.string().optional(),
});

const issueAwbOutputSchema = z
  .object({
    emag_id: z.number().optional(),
    awb: z.array(awbBarcodeSchema).optional(),
    cost: z.number().optional(),
    currency: z.string().optional(),
  })
  .passthrough();

const readAwbInputSchema = z.object({
  emag_id: z.number().int().optional(),
  order_id: z.number().int().optional(),
  rma_id: z.number().int().optional(),
  itemsPerPage: z.number().int().min(1).max(100).optional(),
  currentPage: z.number().int().min(1).optional(),
});

const readAwbOutputSchema = z.array(
  z
    .object({
      emag_id: z.number(),
      order_id: z.number().optional(),
      rma_id: z.number().optional(),
      awb_type: z.union([z.literal(1), z.literal(2)]).optional(),
      weight: z.number().optional(),
      cash_on_delivery: z.number().optional(),
    })
    .passthrough(),
);

const readAwbPdfInputSchema = z.object({
  emag_id: z.number().int().min(1),
  format: z.enum(['A4', 'A5', 'A6', 'ZPL']).optional(),
});

const readAwbPdfOutputSchema = z.object({
  bytes: z.instanceof(Uint8Array),
  contentType: z.string().nullable(),
  status: z.number().int(),
});

const saveAwbPackageInputSchema = z.object({
  packages: z.array(awbPackageTemplateSchema).min(1),
});

const saveAwbPackageOutputSchema = z.unknown();

const readAddressesInputSchema = z.object({
  address_id: z.string().optional(),
  address_type_id: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  country_code: z.string().length(2).optional(),
  itemsPerPage: z.number().int().min(1).optional(),
  currentPage: z.number().int().min(1).optional(),
});

const readAddressesOutputSchema = z.array(z.unknown());

/* === Action input types === */

export type IssueAwbInput = z.infer<typeof issueAwbInputSchema>;
export type ReadAwbInput = z.infer<typeof readAwbInputSchema>;
export type ReadAwbPdfInput = z.infer<typeof readAwbPdfInputSchema>;
export type ReadAddressesInput = z.infer<typeof readAddressesInputSchema>;
export interface SaveAwbPackageInput {
  packages: AwbPackageTemplate[];
}

export interface ReadAwbPdfOutput {
  bytes: Uint8Array;
  contentType: string | null;
  status: number;
}

/**
 * Convertește un obiect parsed (cu chei opționale `T | undefined`) într-unul
 * "exact optional" — efectiv strip-uiește cheile cu valoare `undefined`.
 * Necesitate impusă de `exactOptionalPropertyTypes: true` din tsconfig.
 */
function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/**
 * Factory care produce harta de acțiuni pentru shipping. Primește un getter
 * platform-aware pentru `EmagClient` ca să fie creat lazy de root index.ts
 * (vezi onConfigure pattern). Returnează `ActionHandler`-uri tipate, gata
 * pentru `definePlugin`.
 *
 * `getClientFor` poate fi apelat fără argument pentru DEFAULT_PLATFORM, sau cu
 * un `EmagPlatformKey` explicit pentru suport multi-țară (BG/HU/etc.).
 */
export function shippingActions(
  getClientFor: (platform?: EmagPlatformKey) => Promise<EmagClient>,
): {
  issueAwb: ActionHandler<IssueAwbInput, AwbSaveResult>;
  readAwb: ActionHandler<ReadAwbInput, AwbReadItem[]>;
  readAwbPdf: ActionHandler<ReadAwbPdfInput, ReadAwbPdfOutput>;
  saveAwbPackage: ActionHandler<SaveAwbPackageInput, unknown>;
  readAddresses: ActionHandler<ReadAddressesInput, Address[]>;
} {
  return {
    issueAwb: {
      input: issueAwbInputSchema,
      output: issueAwbOutputSchema as unknown as z.ZodType<AwbSaveResult>,
      handle: async (input: IssueAwbInput): Promise<AwbSaveResult> => {
        // Extrage `platform` din input — e folosit doar pentru rutarea clientului,
        // nu e un câmp eMAG și trebuie scos din payload înainte de apelul HTTP.
        const { platform: platformRaw, ...rest } = input as IssueAwbInput & {
          platform?: string;
        };
        const platform = platformRaw as EmagPlatformKey | undefined;
        const client = await getClientFor(platform);
        const payload = stripUndefined({
          ...rest,
          sender: stripUndefined(rest.sender),
          receiver: stripUndefined(rest.receiver),
        }) as unknown as AwbSavePayload;
        return saveAwb(client, payload);
      },
    },
    readAwb: {
      input: readAwbInputSchema,
      output: readAwbOutputSchema as unknown as z.ZodType<AwbReadItem[]>,
      handle: async (input: ReadAwbInput): Promise<AwbReadItem[]> => {
        const client = await getClientFor();
        const filters = stripUndefined(input) as AwbReadFilters;
        return readAwb(client, filters);
      },
    },
    readAwbPdf: {
      input: readAwbPdfInputSchema,
      output: readAwbPdfOutputSchema,
      handle: async (input: ReadAwbPdfInput): Promise<ReadAwbPdfOutput> => {
        const client = await getClientFor();
        const fmt: AwbPdfFormat = input.format ?? 'A4';
        return readAwbPdf(client, input.emag_id, fmt);
      },
    },
    saveAwbPackage: {
      input: saveAwbPackageInputSchema,
      output: saveAwbPackageOutputSchema,
      handle: async (input: SaveAwbPackageInput): Promise<unknown> => {
        const client = await getClientFor();
        return saveAwbPackages(client, { packages: input.packages });
      },
    },
    readAddresses: {
      input: readAddressesInputSchema,
      output: readAddressesOutputSchema as unknown as z.ZodType<Address[]>,
      handle: async (input: ReadAddressesInput): Promise<Address[]> => {
        const client = await getClientFor();
        return readAddresses(client, input as AddressFilters);
      },
    },
  };
}

/** Descrieri pentru manifest (folosit de wave-ul de wiring). */
export const shippingActionDescriptions: Record<
  'issueAwb' | 'readAwb' | 'readAwbPdf' | 'saveAwbPackage' | 'readAddresses',
  string
> = {
  issueAwb: 'Emite AWB pentru o comandă (awb/save) cu volumetrie completă.',
  readAwb: 'Citește detalii AWB existente (awb/read).',
  readAwbPdf: 'Returnează PDF-ul AWB-ului (awb/read_pdf?emag_id={id}).',
  saveAwbPackage: 'Setează pachetele/volumetria predefinite (awb/package/save).',
  readAddresses: 'Citește adresele de ridicare/retur salvate în contul eMAG (addresses/read).',
};
