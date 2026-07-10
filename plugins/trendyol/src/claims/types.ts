import { z } from 'zod';

import { TRENDYOL_STOREFRONTS, type TrendyolStoreFrontCode } from '../config.js';

const storeFrontCodeSchema = z.enum(
  Object.keys(TRENDYOL_STOREFRONTS) as [TrendyolStoreFrontCode, ...TrendyolStoreFrontCode[]],
);

// ─── getClaims ────────────────────────────────────────────────────────────────

/**
 * Doc § 8 (regiunea CEE, include România) — Returned Order Integration.
 * Statusurile posibile pentru un claim item, exact cum apar în document.
 */
export const CLAIM_ITEM_STATUSES = [
  'Created',
  'WaitingInAction',
  'Accepted',
  'Rejected',
  'Cancelled',
  'Unresolved',
  'InAnalysis',
] as const;

export type ClaimItemStatus = (typeof CLAIM_ITEM_STATUSES)[number];

export const GetClaimsInputSchema = z.object({
  page: z.number().int().min(0).default(0),
  size: z.number().int().min(1).max(200).default(50),
  claimItemStatus: z.enum(CLAIM_ITEM_STATUSES).optional(),
  /** Timestamp ms — filtrează după data creării claim-ului. */
  startDate: z.number().int().optional(),
  /** Timestamp ms. */
  endDate: z.number().int().optional(),
  /** Dacă e setat, ceilalți filtri sunt ignorați de Trendyol (doc § 8). */
  claimIds: z.array(z.string()).optional(),
  orderNumber: z.string().optional(),
  /** Storefront opțional pentru rutare multi-țară (extras de adaptRoutableAction). */
  storeFrontCode: storeFrontCodeSchema.optional(),
});

export type GetClaimsInput = z.infer<typeof GetClaimsInputSchema>;

export const GetClaimsOutputSchema = z.object({
  page: z.number(),
  size: z.number(),
  totalElements: z.number(),
  totalPages: z.number(),
  content: z.array(z.record(z.unknown())),
});

export type GetClaimsOutput = z.infer<typeof GetClaimsOutputSchema>;

// ─── getClaimIssueReasons ───────────────────────────────────────────────────────
// Doc "Claim Issue Reasons" — GET /integration/order/claim-issue-reasons (fără sellerId în path).

export const GetClaimIssueReasonsInputSchema = z.object({
  storeFrontCode: storeFrontCodeSchema.optional(),
});
export type GetClaimIssueReasonsInput = z.infer<typeof GetClaimIssueReasonsInputSchema>;

export const GetClaimIssueReasonsOutputSchema = z.object({
  reasons: z.array(z.object({ id: z.number(), name: z.string() })),
});
export type GetClaimIssueReasonsOutput = z.infer<typeof GetClaimIssueReasonsOutputSchema>;

// ─── approveClaim ─────────────────────────────────────────────────────────────
// Doc "Approve Returned Orders" — PUT .../claims/{claimId}/items/approve, body
// { claimLineItemIdList: [...], params: {} }. Doar claims cu status WaitingInAction.

export const ApproveClaimInputSchema = z.object({
  claimId: z.string().min(1),
  claimLineItemIdList: z.array(z.string().min(1)).min(1),
  storeFrontCode: storeFrontCodeSchema.optional(),
});
export type ApproveClaimInput = z.infer<typeof ApproveClaimInputSchema>;

export const ApproveClaimOutputSchema = z.object({ ok: z.literal(true) });
export type ApproveClaimOutput = z.infer<typeof ApproveClaimOutputSchema>;

// ─── rejectClaim ──────────────────────────────────────────────────────────────
// Doc "createClaimIssue" — POST .../claims/{claimId}/issue, query params
// claimIssueReasonId + claimItemIdList (repetat) + description, corp multipart cu `file`.
// Doar claims cu status WaitingInAction. Poză obligatorie, cu excepția motivelor de mai jos.

export const REJECT_NO_PHOTO_REASON_IDS = [1651, 451, 2101] as const;

export const RejectClaimInputSchema = z.object({
  claimId: z.string().min(1),
  claimItemIdList: z.array(z.string().min(1)).min(1),
  claimIssueReasonId: z.number().int(),
  description: z.string().min(1).max(500),
  /** Fotografie dovadă (base64, fără prefix data:), obligatorie cu excepția REJECT_NO_PHOTO_REASON_IDS. */
  imageBase64: z.string().optional(),
  storeFrontCode: storeFrontCodeSchema.optional(),
});
export type RejectClaimInput = z.infer<typeof RejectClaimInputSchema>;

export const RejectClaimOutputSchema = z.object({ ok: z.literal(true) });
export type RejectClaimOutput = z.infer<typeof RejectClaimOutputSchema>;
