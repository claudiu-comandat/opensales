import {
  olxAttributeSchema,
  olxCategorySchema,
  type ReadCategoryAttributesInput,
  type ReadCategoryAttributesOutput,
  type SyncCategoriesInput,
  type SyncCategoriesOutput,
} from './types.js';

import type { OlxClient } from '../client.js';

/**
 * Listează categoriile OLX (opțional sub un `parentId`). Context client_credentials.
 * Spec: GET /categories?parent_id= → Category[].
 */
export const syncCategories = async (
  client: OlxClient,
  input: SyncCategoriesInput,
): Promise<SyncCategoriesOutput> => {
  const raw = await client.get<unknown[]>('/categories', {
    context: 'client',
    query: { parent_id: input.parentId },
  });
  const categories = olxCategorySchema.array().parse(raw);
  return { categories };
};

/**
 * Citește definițiile de atribute pentru o categorie (cod, label, validare, valori).
 * Spec: GET /categories/{id}/attributes → Attribute[].
 */
export const readCategoryAttributes = async (
  client: OlxClient,
  input: ReadCategoryAttributesInput,
): Promise<ReadCategoryAttributesOutput> => {
  const raw = await client.get<unknown[]>(`/categories/${input.categoryId}/attributes`, {
    context: 'client',
  });
  const attributes = olxAttributeSchema.array().parse(raw);
  return { attributes };
};
