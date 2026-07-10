import { Buffer } from 'node:buffer';

import {
  ApproveClaimInputSchema,
  ApproveClaimOutputSchema,
  GetClaimIssueReasonsInputSchema,
  GetClaimIssueReasonsOutputSchema,
  GetClaimsInputSchema,
  GetClaimsOutputSchema,
  REJECT_NO_PHOTO_REASON_IDS,
  RejectClaimInputSchema,
  RejectClaimOutputSchema,
} from './types.js';

import type { TrendyolClient } from '../client.js';

export interface ClaimActionContext {
  client: TrendyolClient;
}

/** Detectează formatul imaginii din magic bytes ca să nu etichetăm greșit un PNG drept JPEG. */
function detectImage(bytes: Buffer): { mime: string; ext: string } {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  // Fallback: presupunem JPEG (cel mai comun de la camera storage-apk).
  return { mime: 'image/jpeg', ext: 'jpg' };
}

export const claimActions = {
  getClaims: {
    description: 'Pull cererile de retur (claims) din Trendyol — doc § 8, regiunea CEE.',
    input: GetClaimsInputSchema,
    output: GetClaimsOutputSchema,
    async handler(
      input: {
        page?: number;
        size?: number;
        claimItemStatus?: string;
        startDate?: number;
        endDate?: number;
        claimIds?: string[];
        orderNumber?: string;
      },
      { client }: ClaimActionContext,
    ) {
      const parsed = GetClaimsInputSchema.parse(input);
      const params = new URLSearchParams();
      params.set('page', String(parsed.page));
      params.set('size', String(parsed.size));
      if (parsed.claimItemStatus) params.set('claimItemStatus', parsed.claimItemStatus);
      if (parsed.startDate !== undefined) params.set('startDate', String(parsed.startDate));
      if (parsed.endDate !== undefined) params.set('endDate', String(parsed.endDate));
      if (parsed.claimIds?.length) params.set('claimIds', parsed.claimIds.join(','));
      if (parsed.orderNumber) params.set('orderNumber', parsed.orderNumber);
      const path = `/integration/order/sellers/${client.sellerId}/claims?${params.toString()}`;
      const result = await client.get<{
        page: number;
        size: number;
        totalElements: number;
        totalPages: number;
        content: Record<string, unknown>[];
      }>(path);
      return {
        page: result.page ?? parsed.page,
        size: result.size ?? parsed.size,
        totalElements: result.totalElements ?? 0,
        totalPages: result.totalPages ?? 0,
        content: result.content ?? [],
      };
    },
  },

  getClaimIssueReasons: {
    description: 'Motivele de respingere a unui claim (doc "Claim Issue Reasons").',
    input: GetClaimIssueReasonsInputSchema,
    output: GetClaimIssueReasonsOutputSchema,
    async handler(_input: unknown, { client }: ClaimActionContext) {
      // Endpoint global — fără sellerId în path.
      const result = await client.get<{ id: number; name: string }[]>(
        '/integration/order/claim-issue-reasons',
      );
      return { reasons: Array.isArray(result) ? result : [] };
    },
  },

  approveClaim: {
    description:
      'Aprobă un claim Trendyol (doar status WaitingInAction) — doc "Approve Returned Orders".',
    input: ApproveClaimInputSchema,
    output: ApproveClaimOutputSchema,
    async handler(
      input: { claimId: string; claimLineItemIdList: string[] },
      { client }: ClaimActionContext,
    ) {
      const parsed = ApproveClaimInputSchema.parse(input);
      await client.put<void>(
        `/integration/order/sellers/${client.sellerId}/claims/${parsed.claimId}/items/approve`,
        { claimLineItemIdList: parsed.claimLineItemIdList, params: {} },
      );
      return { ok: true as const };
    },
  },

  rejectClaim: {
    description:
      'Respinge un claim Trendyol (createClaimIssue) — poză obligatorie cu excepția motivelor 1651/451/2101.',
    input: RejectClaimInputSchema,
    output: RejectClaimOutputSchema,
    async handler(
      input: {
        claimId: string;
        claimItemIdList: string[];
        claimIssueReasonId: number;
        description: string;
        imageBase64?: string;
      },
      { client }: ClaimActionContext,
    ) {
      const parsed = RejectClaimInputSchema.parse(input);
      const requiresPhoto = !REJECT_NO_PHOTO_REASON_IDS.includes(
        parsed.claimIssueReasonId as (typeof REJECT_NO_PHOTO_REASON_IDS)[number],
      );
      if (requiresPhoto && !parsed.imageBase64) {
        throw new Error(
          `Motivul ${parsed.claimIssueReasonId} necesită o fotografie (imageBase64 lipsă)`,
        );
      }

      const params = new URLSearchParams();
      params.set('claimIssueReasonId', String(parsed.claimIssueReasonId));
      // Trendyol acceptă claimItemIdList ca parametru repetat.
      for (const id of parsed.claimItemIdList) params.append('claimItemIdList', id);
      params.set('description', parsed.description);
      const path = `/integration/order/sellers/${client.sellerId}/claims/${parsed.claimId}/issue?${params.toString()}`;

      const form = new FormData();
      if (parsed.imageBase64) {
        // Acceptă și forma `data:image/png;base64,...` — altfel Buffer.from decodează prefixul
        // ca octeți, corupând imaginea (decoderul base64 din Node nu aruncă, doar produce gunoi).
        const b64 = parsed.imageBase64.replace(/^data:[^;,]*;base64,/, '');
        const bytes = Buffer.from(b64, 'base64');
        const { mime, ext } = detectImage(bytes);
        form.append('file', new Blob([bytes], { type: mime }), `reject.${ext}`);
      }
      await client.postMultipart<void>(path, form);
      return { ok: true as const };
    },
  },
} as const;

export type ClaimActions = typeof claimActions;
