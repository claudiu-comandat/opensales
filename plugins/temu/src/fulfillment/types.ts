import { z } from 'zod';

// ─── confirmShipment ──────────────────────────────────────────────────────────

export const ConfirmShipmentInputSchema = z.object({
  /** Pachetele de expediat. Fiecare pachet conține orderSn-uri și info tracking. */
  packageList: z
    .array(
      z.object({
        /** Numărul comenzii parente */
        parentOrderSn: z.string().min(1),
        /** Lista de sub-comenzi incluse în pachet */
        orderSnList: z.array(z.string()).min(1),
        /** Codul curierului (din bg.logistics.companies.get) */
        trackingCompany: z.string().min(1),
        /** Numărul de tracking */
        trackingNumber: z.string().min(1),
      }),
    )
    .min(1),
});

export type ConfirmShipmentInput = z.infer<typeof ConfirmShipmentInputSchema>;

export const ConfirmShipmentOutputSchema = z.object({
  success: z.boolean(),
  failedList: z.array(z.record(z.unknown())).optional(),
});

export type ConfirmShipmentOutput = z.infer<typeof ConfirmShipmentOutputSchema>;

// ─── getLogisticsCompanies ────────────────────────────────────────────────────

export const GetLogisticsCompaniesInputSchema = z.object({
  /** Region ID — e.g. USA=211, pentru EU verifică documentația */
  regionId: z.number().int(),
});

export type GetLogisticsCompaniesInput = z.infer<typeof GetLogisticsCompaniesInputSchema>;

export const GetLogisticsCompaniesOutputSchema = z.array(z.record(z.unknown()));

export type GetLogisticsCompaniesOutput = z.infer<typeof GetLogisticsCompaniesOutputSchema>;
