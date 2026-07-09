import { z } from 'zod';

// ─── getCategoryList ──────────────────────────────────────────────────────────

export const GetCategoryListOutputSchema = z.array(z.record(z.unknown()));
export type GetCategoryListOutput = z.infer<typeof GetCategoryListOutputSchema>;

// ─── getBrandList ─────────────────────────────────────────────────────────────

export const GetBrandListInputSchema = z.object({
  name: z.string().optional(),
  page: z.number().int().min(0).default(0),
  size: z.number().int().min(1).max(500).default(500),
});

export type GetBrandListInput = z.infer<typeof GetBrandListInputSchema>;

export const GetBrandListOutputSchema = z.array(z.record(z.unknown()));
export type GetBrandListOutput = z.infer<typeof GetBrandListOutputSchema>;

// ─── getCategoryAttributes ────────────────────────────────────────────────────

export const GetCategoryAttributesInputSchema = z.object({
  categoryId: z.number().int(),
});

export type GetCategoryAttributesInput = z.infer<typeof GetCategoryAttributesInputSchema>;

export const GetCategoryAttributesOutputSchema = z.record(z.unknown());
export type GetCategoryAttributesOutput = z.infer<typeof GetCategoryAttributesOutputSchema>;
