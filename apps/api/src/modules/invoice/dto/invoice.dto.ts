import { z } from 'zod';

export const invoiceSchema = z.object({
  series: z.string().min(1).max(16),
  number: z.string().min(1).max(32),
  pdfUrl: z.string().url().optional(),
  status: z.enum(['draft', 'issued', 'cancelled']),
  issuedAt: z.coerce.date(),
});

export type InvoiceDto = z.infer<typeof invoiceSchema>;
