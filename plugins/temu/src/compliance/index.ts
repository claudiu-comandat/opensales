import {
  EditComplianceInputSchema,
  EditComplianceOutputSchema,
  GetBrandTrademarksInputSchema,
  GetBrandTrademarksOutputSchema,
  GetComplianceContactsInputSchema,
  GetComplianceContactsOutputSchema,
  GetComplianceExtraTemplateInputSchema,
  GetComplianceExtraTemplateOutputSchema,
  GetProductAttributesInputSchema,
  GetProductAttributesOutputSchema,
  SubmitForReviewInputSchema,
  SubmitForReviewOutputSchema,
} from './types.js';

import type { TemuClient } from '../client.js';

export interface ComplianceActionContext {
  client: TemuClient;
}

/**
 * Acțiuni pentru completarea unui produs Temu și trimiterea lui la validare.
 *
 * Lookup-uri read-only (descoperire ID-uri / câmpuri obligatorii) + două acțiuni
 * de scriere: `editCompliance` (GPSR + extraTemplate) și `submitForReview`
 * (saveMode:1, mută draft → pending review).
 *
 * NOTĂ wrapping: toate aceste endpoint-uri primesc parametrii FLAT la rădăcină
 * (ca `bg.local.goods.partial.update` / `stock.edit` și exemplele din documentație),
 * NU învelite într-un `data: {...}`. Un wrapper greșit declanșează 150011003.
 */
export const complianceActions = {
  getBrandTrademarks: {
    description:
      'Listă branduri/trademark înregistrate de vânzător — temu.local.goods.brand.trademark.V2.get.',
    input: GetBrandTrademarksInputSchema,
    output: GetBrandTrademarksOutputSchema,
    async handler(input: unknown, { client }: ComplianceActionContext) {
      const parsed = GetBrandTrademarksInputSchema.parse(input);
      const result = await client.call<{
        trademarkList?: Record<string, unknown>[];
        totalNum?: number;
        pageNo?: number;
      }>('temu.local.goods.brand.trademark.V2.get', { page: parsed.page, size: parsed.size });
      return {
        trademarkList: result.trademarkList ?? [],
        totalNum: result.totalNum,
        pageNo: result.pageNo,
      };
    },
  },

  getComplianceContacts: {
    description:
      'Listă entități GPSR înregistrate (producător/responsabil EU) — bg.local.goods.compliance.info.fill.list.query.',
    input: GetComplianceContactsInputSchema,
    output: GetComplianceContactsOutputSchema,
    async handler(input: unknown, { client }: ComplianceActionContext) {
      const parsed = GetComplianceContactsInputSchema.parse(input);
      const result = await client.call<{
        authRepInfoList?: Record<string, unknown>[];
        total?: number;
      }>('bg.local.goods.compliance.info.fill.list.query', {
        complianceInfoType: parsed.complianceInfoType,
        page: parsed.page,
        size: parsed.size,
        ...(parsed.searchText !== undefined ? { searchText: parsed.searchText } : {}),
        ...(parsed.language !== undefined ? { language: parsed.language } : {}),
      });
      return {
        authRepInfoList: result.authRepInfoList ?? [],
        total: result.total,
      };
    },
  },

  getProductAttributes: {
    description:
      'Atributele unei categorii (required + valori/unități) — temu.local.product.attributes.get.',
    input: GetProductAttributesInputSchema,
    output: GetProductAttributesOutputSchema,
    async handler(input: unknown, { client }: ComplianceActionContext) {
      const parsed = GetProductAttributesInputSchema.parse(input);
      const result = await client.call<{
        catId?: number;
        language?: string;
        attributeList?: Record<string, unknown>[];
      }>('temu.local.product.attributes.get', {
        catId: parsed.catId,
        ...(parsed.language !== undefined ? { language: parsed.language } : {}),
        ...(parsed.costTemplateId !== undefined ? { costTemplateId: parsed.costTemplateId } : {}),
      });
      return {
        catId: result.catId,
        language: result.language,
        attributeList: result.attributeList ?? [],
      };
    },
  },

  getComplianceExtraTemplate: {
    description:
      'Șabloane compliance/guvernanță per categorie (identificare/ambalaj) — bg.local.goods.compliance.extra.template.get.',
    input: GetComplianceExtraTemplateInputSchema,
    output: GetComplianceExtraTemplateOutputSchema,
    async handler(input: unknown, { client }: ComplianceActionContext) {
      const parsed = GetComplianceExtraTemplateInputSchema.parse(input);
      const result = await client.call<{ extraTemplateList?: Record<string, unknown>[] }>(
        'bg.local.goods.compliance.extra.template.get',
        {
          catId: parsed.catId,
          ...(parsed.goodsId !== undefined ? { goodsId: parsed.goodsId } : {}),
        },
      );
      return {
        extraTemplateList: result.extraTemplateList ?? [],
      };
    },
  },

  editCompliance: {
    description:
      'Completează GPSR + extraTemplate pe un produs existent — bg.local.goods.compliance.edit.',
    input: EditComplianceInputSchema,
    output: EditComplianceOutputSchema,
    async handler(input: unknown, { client }: ComplianceActionContext) {
      const parsed = EditComplianceInputSchema.parse(input);
      // Parametri flat la rădăcină; trimitem doar secțiunile prezente.
      await client.call<Record<string, unknown>>('bg.local.goods.compliance.edit', {
        goodsId: parsed.goodsId,
        ...(parsed.gpsrInfo !== undefined ? { gpsrInfo: parsed.gpsrInfo } : {}),
        ...(parsed.extraTemplate !== undefined ? { extraTemplate: parsed.extraTemplate } : {}),
        ...(parsed.certificateInfo !== undefined
          ? { certificateInfo: parsed.certificateInfo }
          : {}),
        ...(parsed.repInfo !== undefined ? { repInfo: parsed.repInfo } : {}),
      });
      return { success: true };
    },
  },

  submitForReview: {
    description:
      'Trimite produsul la validare (saveMode:1, draft → pending review) — bg.local.goods.partial.update.',
    input: SubmitForReviewInputSchema,
    output: SubmitForReviewOutputSchema,
    async handler(input: unknown, { client }: ComplianceActionContext) {
      const parsed = SubmitForReviewInputSchema.parse(input);
      // Parametri flat la rădăcină (ca bg.local.goods.partial.update pentru preț/stoc).
      const result = await client.call<{ modifyId?: string }>('bg.local.goods.partial.update', {
        goodsId: parsed.goodsId,
        saveMode: parsed.saveMode,
        ...(parsed.goodsTrademark !== undefined ? { goodsTrademark: parsed.goodsTrademark } : {}),
        ...(parsed.goodsOriginInfo !== undefined
          ? { goodsOriginInfo: parsed.goodsOriginInfo }
          : {}),
        ...(parsed.taxCodeInfo !== undefined ? { taxCodeInfo: parsed.taxCodeInfo } : {}),
      });
      return { success: true, modifyId: result.modifyId };
    },
  },
} as const;

export type ComplianceActions = typeof complianceActions;
