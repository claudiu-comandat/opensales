import { createZodDto } from 'nestjs-zod';

import { createProductSchema } from './create-product.dto.js';

export const updateProductSchema = createProductSchema.partial();

export class UpdateProductDto extends createZodDto(updateProductSchema) {}
