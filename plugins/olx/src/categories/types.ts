import { z } from 'zod';

/** Categorie OLX. Spec: components/schemas/Category. */
export const olxCategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  parent_id: z.number().nullable().optional(),
  photos_limit: z.number().optional(),
  is_leaf: z.boolean().optional(),
});
export type OlxCategory = z.infer<typeof olxCategorySchema>;

/** Reguli de validare pentru un atribut. Spec: Attribute.validation. */
export const olxAttributeValidationSchema = z.object({
  type: z.enum(['salary', 'price', 'attribute']).optional(),
  required: z.boolean().optional(),
  numeric: z.boolean().optional(),
  min: z.number().optional(),
  max: z.union([z.number(), z.string()]).optional(),
  allow_multiple_values: z.boolean().optional(),
});

/** Definiție de atribut pentru o categorie. Spec: components/schemas/Attribute. */
export const olxAttributeSchema = z.object({
  code: z.string(),
  label: z.string(),
  unit: z.string().optional(),
  validation: olxAttributeValidationSchema.optional(),
  values: z
    .array(
      z.object({
        code: z.string().optional(),
        label: z.string().optional(),
      }),
    )
    .optional(),
});
export type OlxAttribute = z.infer<typeof olxAttributeSchema>;

export const syncCategoriesInputSchema = z.object({
  parentId: z.number().optional(),
});
export type SyncCategoriesInput = z.infer<typeof syncCategoriesInputSchema>;

export const syncCategoriesOutputSchema = z.object({
  categories: z.array(olxCategorySchema),
});
export type SyncCategoriesOutput = z.infer<typeof syncCategoriesOutputSchema>;

export const readCategoryAttributesInputSchema = z.object({
  categoryId: z.number(),
});
export type ReadCategoryAttributesInput = z.infer<typeof readCategoryAttributesInputSchema>;

export const readCategoryAttributesOutputSchema = z.object({
  attributes: z.array(olxAttributeSchema),
});
export type ReadCategoryAttributesOutput = z.infer<typeof readCategoryAttributesOutputSchema>;
