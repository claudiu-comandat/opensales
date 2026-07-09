import {
  PushGoodsInputSchema,
  PushGoodsOutputSchema,
  ReadCategoriesInputSchema,
  ReadCategoriesOutputSchema,
  SetSaleStatusInputSchema,
  SetSaleStatusOutputSchema,
  SyncGoodsInputSchema,
  SyncGoodsOutputSchema,
  UpdatePriceInputSchema,
  UpdatePriceOutputSchema,
  UpdateStockInputSchema,
  UpdateStockOutputSchema,
  UploadGoodsImageInputSchema,
  UploadGoodsImageOutputSchema,
} from './types.js';

import type { TemuClient } from '../client.js';

export interface GoodsActionContext {
  client: TemuClient;
}

export const goodsActions = {
  syncGoods: {
    description: 'Pull lista de produse din Temu — bg.local.goods.list.get.',
    input: SyncGoodsInputSchema,
    output: SyncGoodsOutputSchema,
    async handler(
      input: { page?: number; pageSize?: number; saleStatus?: number; goodsName?: string },
      { client }: GoodsActionContext,
    ) {
      const parsed = SyncGoodsInputSchema.parse(input);
      const result = await client.call<Record<string, unknown>>('bg.local.goods.list.get', {
        data: {
          page: parsed.page,
          pageSize: parsed.pageSize,
          ...(parsed.saleStatus !== undefined && { saleStatus: parsed.saleStatus }),
          ...(parsed.goodsName !== undefined && { goodsName: parsed.goodsName }),
        },
      });
      return {
        goods: (result.goodsInfoList as Record<string, unknown>[]) ?? [],
        total: result.total as number | undefined,
        page: parsed.page,
        pageSize: parsed.pageSize,
      };
    },
  },

  updateStock: {
    description: 'Actualizează stocul SKU-urilor — bg.local.goods.stock.edit.',
    input: UpdateStockInputSchema,
    output: UpdateStockOutputSchema,
    async handler(input: unknown, { client }: GoodsActionContext) {
      const parsed = UpdateStockInputSchema.parse(input);
      // Parametri flat la rădăcină (ca în documentația stock.edit), fără `data`.
      const result = await client.call<Record<string, unknown>>('bg.local.goods.stock.edit', {
        goodsId: parsed.goodsId,
        stockType: parsed.stockType,
        skuStockTargetList: parsed.skuStockTargetList,
        ...(parsed.requestUniqueKey ? { requestUniqueKey: parsed.requestUniqueKey } : {}),
      });
      return {
        success: true,
        failedList: (result.failedList as Record<string, unknown>[]) ?? [],
      };
    },
  },

  updatePrice: {
    description: 'Actualizează prețul unui SKU — bg.local.goods.partial.update.',
    input: UpdatePriceInputSchema,
    output: UpdatePriceOutputSchema,
    async handler(input: unknown, { client }: GoodsActionContext) {
      const parsed = UpdatePriceInputSchema.parse(input);
      // Parametri flat la rădăcină (ca în bg.local.goods.stock.edit), fără `data`.
      await client.call<Record<string, unknown>>('bg.local.goods.partial.update', {
        goodsId: parsed.goodsId,
        skuList: [
          {
            skuId: parsed.skuId,
            basePrice: {
              amount: parsed.amount,
              currency: parsed.currency,
            },
          },
        ],
      });
      return { success: true };
    },
  },

  setSaleStatus: {
    description: 'Activează/dezactivează un produs — bg.local.goods.status.edit.',
    input: SetSaleStatusInputSchema,
    output: SetSaleStatusOutputSchema,
    async handler(
      input: { goodsId: number; saleStatus: 0 | 1; operationType?: 1 | 2 },
      { client }: GoodsActionContext,
    ) {
      const parsed = SetSaleStatusInputSchema.parse(input);
      await client.call<Record<string, unknown>>('bg.local.goods.status.edit', {
        data: {
          goodsId: parsed.goodsId,
          saleStatus: parsed.saleStatus,
          operationType: parsed.operationType,
        },
      });
      return { success: true };
    },
  },

  pushGoods: {
    description: 'Creează un produs nou pe Temu — temu.local.goods.v2.add.',
    input: PushGoodsInputSchema,
    output: PushGoodsOutputSchema,
    async handler(input: unknown, { client }: GoodsActionContext) {
      const parsed = PushGoodsInputSchema.parse(input);
      // Endpoint-urile `temu.*` (spre deosebire de `bg.local.*`) cer parametrii
      // de business FLAT la rădăcină, NU învelite într-un `data: {...}`. Un wrapper
      // `data` declanșează `Invalid Request Parameters [goodsBasic]` (150011003).
      const result = await client.call<Record<string, unknown>>('temu.local.goods.v2.add', {
        goodsBasic: parsed.goodsBasic,
        goodsServicePromise: parsed.goodsServicePromise,
        skuList: parsed.skuList,
        ...(parsed.goodsProperty ? { goodsProperty: parsed.goodsProperty } : {}),
        ...(parsed.goodsOriginInfo ? { goodsOriginInfo: parsed.goodsOriginInfo } : {}),
      });
      return {
        success: true,
        goodsId: result.goodsId as number | undefined,
        skuInfoList: (result.skuInfoList as { skuId?: number; outSkuSn?: string }[]) ?? [],
        failedList: (result.failedList as Record<string, unknown>[]) ?? [],
      };
    },
  },

  uploadGoodsImage: {
    description: 'Încarcă o imagine pe CDN-ul Temu — temu.local.goods.image.v2.upload.',
    input: UploadGoodsImageInputSchema,
    output: UploadGoodsImageOutputSchema,
    async handler(input: unknown, { client }: GoodsActionContext) {
      const parsed = UploadGoodsImageInputSchema.parse(input);
      // Parametri flat la rădăcină (ca temu.local.goods.v2.add), fără `data`.
      const result = await client.call<{ images?: { url: string }[] }>(
        'temu.local.goods.image.v2.upload',
        { fileUrl: parsed.fileUrl, catId: parsed.catId, usage: parsed.usage },
      );
      const url = result.images?.[0]?.url;
      if (!url) {
        throw new Error('Temu image upload nu a returnat un url');
      }
      return { url };
    },
  },

  readCategories: {
    description: 'Citește categoriile Temu — bg.local.goods.cats.get.',
    input: ReadCategoriesInputSchema,
    output: ReadCategoriesOutputSchema,
    async handler(
      input: { parentCatId?: number; language?: string },
      { client }: GoodsActionContext,
    ) {
      const parsed = ReadCategoriesInputSchema.parse(input);
      const result = await client.call<Record<string, unknown>>('bg.local.goods.cats.get', {
        data: {
          parentCatId: parsed.parentCatId,
          ...(parsed.language !== undefined && { language: parsed.language }),
        },
      });
      return (result.catList as Record<string, unknown>[]) ?? [];
    },
  },
} as const;

export type GoodsActions = typeof goodsActions;
