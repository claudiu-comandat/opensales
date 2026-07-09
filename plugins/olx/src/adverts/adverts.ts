import { moneyToOlxValue } from './money.js';
import {
  advertEnvelopeSchema,
  olxAdvertSchema,
  type AdvertCommandInput,
  type CreateAdvertInput,
  type DeleteAdvertInput,
  type OlxAdvert,
  type SyncAdvertsInput,
  type SyncAdvertsOutput,
  type UpdateAdvertInput,
} from './types.js';

import type { OlxClient } from '../client.js';

/** Payload OLX pentru create/update advert (snake_case, preț în unități majore). */
export interface OlxAdvertPayload {
  title?: string;
  description?: string;
  category_id?: number;
  advertiser_type?: 'private' | 'business';
  contact?: { name: string; phone?: string | undefined };
  location?: {
    city_id: number;
    district_id?: number | null | undefined;
    latitude?: number | undefined;
    longitude?: number | undefined;
  };
  attributes?: { code: string; value?: string | null; values?: string[] | null }[];
  price?: { value: number; currency: string };
  images?: { url: string }[];
  external_id?: string;
  external_url?: string;
  auto_extend_enabled?: boolean;
}

/**
 * Mapează modelul OpenSales (camelCase, preț ca Money) la payload-ul OLX
 * (snake_case, preț în unități majore). Câmpurile absente sunt omise — important
 * pentru update parțial și pentru `exactOptionalPropertyTypes`.
 */
export function buildCreateAdvertPayload(input: {
  [K in keyof CreateAdvertInput]?: CreateAdvertInput[K] | undefined;
}): OlxAdvertPayload {
  const payload: OlxAdvertPayload = {};
  if (input.title !== undefined) payload.title = input.title;
  if (input.description !== undefined) payload.description = input.description;
  if (input.categoryId !== undefined) payload.category_id = input.categoryId;
  if (input.advertiserType !== undefined) payload.advertiser_type = input.advertiserType;
  if (input.contact !== undefined) payload.contact = input.contact;
  if (input.location !== undefined) payload.location = input.location;
  if (input.attributes !== undefined) {
    payload.attributes = input.attributes.map((a) => ({
      code: a.code,
      ...(a.value !== undefined ? { value: a.value } : {}),
      ...(a.values !== undefined ? { values: a.values } : {}),
    }));
  }
  if (input.price !== undefined) payload.price = moneyToOlxValue(input.price);
  if (input.images !== undefined) payload.images = input.images;
  if (input.externalId !== undefined) payload.external_id = input.externalId;
  if (input.externalUrl !== undefined) payload.external_url = input.externalUrl;
  if (input.autoExtendEnabled !== undefined) payload.auto_extend_enabled = input.autoExtendEnabled;
  return payload;
}

/**
 * Publică un anunț nou. Spec: POST /adverts (context user). Returnează advert-ul
 * cu status-ul curent (new/limited/active).
 */
export const createAdvert = async (
  client: OlxClient,
  input: CreateAdvertInput,
): Promise<OlxAdvert> => {
  const payload = buildCreateAdvertPayload(input);
  const raw = await client.post('/adverts', payload, { context: 'user' });
  return advertEnvelopeSchema.parse(raw).data;
};

/** Actualizează un anunț existent (doar câmpurile furnizate). Spec: PUT /adverts/{id}. */
export const updateAdvert = async (
  client: OlxClient,
  input: UpdateAdvertInput,
): Promise<OlxAdvert> => {
  const { advertId, ...rest } = input;
  const payload = buildCreateAdvertPayload(rest);
  const raw = await client.put(`/adverts/${advertId}`, payload, { context: 'user' });
  return advertEnvelopeSchema.parse(raw).data;
};

/**
 * Șterge un anunț. Spec: DELETE /adverts/{id} → 204. Anunțul nu trebuie să fie
 * activ — dezactivează-l întâi cu advertCommand('deactivate').
 */
export const deleteAdvert = async (client: OlxClient, input: DeleteAdvertInput): Promise<void> => {
  await client.delete(`/adverts/${input.advertId}`, { context: 'user' });
};

/** Listează anunțurile utilizatorului. Spec: GET /adverts → { data: Advert[] }. */
export const syncAdverts = async (
  client: OlxClient,
  input: SyncAdvertsInput,
): Promise<SyncAdvertsOutput> => {
  const raw = await client.get('/adverts', {
    context: 'user',
    query: {
      offset: input.offset,
      limit: input.limit,
      external_id: input.externalId,
      category_ids: input.categoryIds ? input.categoryIds.join(',') : undefined,
    },
  });
  const parsed = (raw as { data?: unknown }).data ?? [];
  return { adverts: olxAdvertSchema.array().parse(parsed) };
};

/**
 * Execută o comandă pe un anunț. Spec: POST /adverts/{id}/commands → 204.
 * `is_success` e obligatoriu pentru `deactivate`.
 */
export const advertCommand = async (
  client: OlxClient,
  input: AdvertCommandInput,
): Promise<void> => {
  const body: Record<string, unknown> = { command: input.command };
  if (input.isSuccess !== undefined) body.is_success = input.isSuccess;
  await client.post(`/adverts/${input.advertId}/commands`, body, { context: 'user' });
};
