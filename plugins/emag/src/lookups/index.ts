import { z } from 'zod';

import type { ActionHandler, ActionHandlerMap } from '@opensales/plugin-sdk';

import { readCategories } from './categories.js';
import { CategoryLanguage } from './types.js';

import type { EmagClient } from '../client.js';
import type { CategoryReadFilters, CategoryReadResult, EmagCategory } from './types.js';

export { readCategories, countCategories } from './categories.js';
export { readVat } from './vat.js';
export { readHandlingTime } from './handling-time.js';
export { readInvoiceCategories, readInvoices, readCustomerInvoices } from './invoices.js';
export { CharacteristicTypeId, CategoryLanguage } from './types.js';
export type {
  CategoryCharacteristic,
  CategoryLanguageValue,
  CategoryReadFilters,
  CategoryReadResult,
  CharacteristicTypeIdValue,
  CustomerInvoiceReadFilters,
  CustomerInvoiceReadResult,
  EmagCategory,
  EmagCustomerInvoice,
  EmagHandlingTime,
  EmagInvoice,
  EmagInvoiceCategory,
  EmagVatRate,
  FamilyType,
  FamilyTypeCharacteristic,
  InvoiceReadFilters,
  InvoiceReadResult,
} from './types.js';

/**
 * Zod schemas pentru `lookupActions`. Doar `readCategories` e expus ca acțiune
 * platformei; restul lookup-urilor (vat, handling_time, invoice) sunt cheap și
 * folosite intern de alte wave-uri (offers, orders), deci sunt expuse doar ca
 * helpers exportabili.
 */
const categoryLanguageEnumValues: readonly [string, ...string[]] = Object.values(
  CategoryLanguage,
) as [string, ...string[]];

const categoryReadInputSchema = z
  .object({
    id: z.number().int().positive().optional(),
    language: z.enum(categoryLanguageEnumValues).optional(),
    currentPage: z.number().int().positive().optional(),
    itemsPerPage: z.number().int().positive().max(4000).optional(),
    valuesCurrentPage: z.number().int().positive().optional(),
    valuesPerPage: z.number().int().positive().max(256).optional(),
  })
  .strict();

type CategoryReadInput = z.infer<typeof categoryReadInputSchema>;

const categoryCharacteristicSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    type_id: z.number().optional(),
    display_order: z.number().optional(),
    is_mandatory: z.number().optional(),
    is_filter: z.number().optional(),
    allow_new_value: z.number().optional(),
    values: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    required: z.number().optional(),
  })
  .passthrough();

const familyTypeSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    characteristics: z
      .array(
        z
          .object({
            characteristic_id: z.number(),
            characteristic_family_type_id: z.number().optional(),
            is_foldable: z.number().optional(),
            display_order: z.number().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const categorySchema = z
  .object({
    id: z.number(),
    name: z.string(),
    is_allowed: z.number(),
    parent_id: z.number().optional(),
    is_ean_mandatory: z.number().optional(),
    is_warranty_mandatory: z.number().optional(),
    characteristics: z.array(categoryCharacteristicSchema).optional(),
    family_types: z.array(familyTypeSchema).optional(),
  })
  .passthrough();

const categoryReadOutputSchema = z.object({
  items: z.array(categorySchema),
  currentPage: z.number(),
  itemsPerPage: z.number(),
  totalCount: z.number().optional(),
});

/**
 * Build action handler map pentru lookups. Caller-ul (plugin index.ts) trebuie
 * să trimită un getter de client — păstrăm decuplarea cu lazy resolution ca să
 * permitem reconfigurări la runtime.
 */
export const buildLookupActions = (getClient: () => Promise<EmagClient>): ActionHandlerMap => {
  const readCategoriesAction: ActionHandler<CategoryReadInput, CategoryReadResult> = {
    input: categoryReadInputSchema,
    output: categoryReadOutputSchema as unknown as z.ZodType<CategoryReadResult>,
    handle: async (input: CategoryReadInput): Promise<CategoryReadResult> => {
      const client = await getClient();
      const filters: CategoryReadFilters = {};
      if (input.id !== undefined) filters.id = input.id;
      if (input.language !== undefined) {
        filters.language = input.language as NonNullable<CategoryReadFilters['language']>;
      }
      if (input.currentPage !== undefined) filters.currentPage = input.currentPage;
      if (input.itemsPerPage !== undefined) filters.itemsPerPage = input.itemsPerPage;
      if (input.valuesCurrentPage !== undefined) {
        filters.valuesCurrentPage = input.valuesCurrentPage;
      }
      if (input.valuesPerPage !== undefined) filters.valuesPerPage = input.valuesPerPage;
      return readCategories(client, filters);
    },
  };
  return {
    readCategories: readCategoriesAction as unknown as ActionHandler<unknown, unknown>,
  };
};

/**
 * Re-export sub forma cerută de specificația wave-ului.
 *
 * @deprecated Folosește `buildLookupActions` direct — exportăm `lookupActions`
 * doar pentru consumatori care nu au nevoie de lazy client resolution. În
 * practică, plugin-ul `index.ts` (Wave 1) construiește `lookupActions` cu
 * propriul getter.
 */
export const lookupActions = (getClient: () => Promise<EmagClient>): ActionHandlerMap =>
  buildLookupActions(getClient);

/** Helper utilizat de `EmagCategory` consumers — re-export pentru convenience. */
export type LookupReadCategoriesInput = CategoryReadInput;
export type LookupReadCategoriesOutput = CategoryReadResult;
export type LookupCategoryItem = EmagCategory;
