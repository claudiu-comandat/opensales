import type { EmagClient } from '../client.js';
import type {
  AwbPdfFormat,
  AwbPdfResult,
  AwbReadFilters,
  AwbReadItem,
  AwbSavePayload,
  AwbSaveResult,
} from './types.js';

/**
 * Citește AWB-uri existente (doc § 6.2). eMAG acceptă filtre pe emag_id,
 * order_id, rma_id + paginare standard.
 */
export const readAwb = (client: EmagClient, filters: AwbReadFilters = {}): Promise<AwbReadItem[]> =>
  client.read<AwbReadItem[]>('awb', { ...filters });

/**
 * Emite un AWB nou (doc § 6.1). Payload-ul include cheile de volumetrie
 * adăugate în 4.5.1 (length, width, height pe fiecare pachet).
 */
export const saveAwb = (client: EmagClient, payload: AwbSavePayload): Promise<AwbSaveResult> =>
  client.save<AwbSaveResult>('awb', payload);

/**
 * Descarcă PDF-ul unui AWB (doc § 6.3). Endpoint binar, nu JSON.
 *
 * eMAG folosește `awb/read_pdf?emag_id={id}&awb_format=A4`. Acceptăm un format
 * opțional (default A4). Pentru ZPL eMAG returnează base64 într-un alt
 * endpoint (`awb/read_zpl`), dar permițând `format='ZPL'` aici e mai uniform.
 */
export const readAwbPdf = (
  client: EmagClient,
  emagAwbId: number,
  format: AwbPdfFormat = 'A4',
): Promise<AwbPdfResult> => {
  const path = `awb/read_pdf?emag_id=${emagAwbId}&awb_format=${format}`;
  return client.getRaw(path);
};
