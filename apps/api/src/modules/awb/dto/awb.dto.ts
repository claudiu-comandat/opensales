import { z } from 'zod';

export const awbSchema = z.object({
  number: z.string().min(1).max(64),
  tracking: z.string().max(128).optional(),
  carrierPluginId: z.string().uuid(),
  pdfUrl: z.string().url().optional(),
  status: z.enum(['pending', 'issued', 'in_transit', 'delivered', 'returned', 'cancelled']),
  issuedAt: z.coerce.date(),
  /** ID intern eMAG returnat de awb/save. Necesar pentru polling status via awb/read. */
  emagId: z.number().int().positive().optional(),
});

export type AwbDto = z.infer<typeof awbSchema>;
