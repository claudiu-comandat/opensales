import {
  GetBrandListInputSchema,
  GetBrandListOutputSchema,
  GetCategoryAttributesInputSchema,
  GetCategoryAttributesOutputSchema,
  GetCategoryListOutputSchema,
} from './types.js';

import type { TrendyolClient } from '../client.js';

export interface CategoryActionContext {
  client: TrendyolClient;
}

export const categoryActions = {
  getCategoryList: {
    description: 'Returnează lista completă de categorii Trendyol.',
    input: GetCategoryListOutputSchema.optional().default([]),
    output: GetCategoryListOutputSchema,
    async handler(_input: unknown, { client }: CategoryActionContext) {
      const result = await client.get<{ categories: Record<string, unknown>[] }>(
        '/integration/product/product-categories',
        true, // slow limiter (50 req/min)
      );
      return result.categories ?? [];
    },
  },

  getBrandList: {
    description: 'Returnează lista de branduri Trendyol.',
    input: GetBrandListInputSchema,
    output: GetBrandListOutputSchema,
    async handler(
      input: { name?: string; page?: number; size?: number },
      { client }: CategoryActionContext,
    ) {
      const parsed = GetBrandListInputSchema.parse(input);
      const params = new URLSearchParams();
      params.set('page', String(parsed.page));
      params.set('size', String(parsed.size));
      if (parsed.name) params.set('name', parsed.name);
      const path = `/integration/product/brands?${params.toString()}`;
      const result = await client.get<Record<string, unknown>[]>(path, true);
      return Array.isArray(result) ? result : [];
    },
  },

  getCategoryAttributes: {
    description: 'Returnează atributele V2 ale unei categorii.',
    input: GetCategoryAttributesInputSchema,
    output: GetCategoryAttributesOutputSchema,
    async handler(input: { categoryId: number }, { client }: CategoryActionContext) {
      const parsed = GetCategoryAttributesInputSchema.parse(input);
      return client.get<Record<string, unknown>>(
        `/integration/product/categories/${parsed.categoryId}/attributes`,
        true,
      );
    },
  },
} as const;

export type CategoryActions = typeof categoryActions;
