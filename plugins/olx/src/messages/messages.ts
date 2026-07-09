import {
  olxMessageSchema,
  type ReadMessagesInput,
  type ReadMessagesOutput,
  type SendMessageInput,
  type SendMessageOutput,
} from './types.js';

import type { OlxClient } from '../client.js';

/**
 * Citește mesajele dintr-un thread. Spec: GET /threads/{id}/messages → Message[].
 * Context user (authorization_code / refresh_token).
 */
export const readMessages = async (
  client: OlxClient,
  input: ReadMessagesInput,
): Promise<ReadMessagesOutput> => {
  const raw = await client.get<unknown[]>(`/threads/${input.threadId}/messages`, {
    context: 'user',
  });
  return { messages: olxMessageSchema.array().parse(raw) };
};

/**
 * Trimite un mesaj într-un thread. Spec: POST /threads/{id}/messages → 200.
 * `text` obligatoriu; `attachments` opțional.
 */
export const sendMessage = async (
  client: OlxClient,
  input: SendMessageInput,
): Promise<SendMessageOutput> => {
  const body: Record<string, unknown> = { text: input.text };
  if (input.attachments !== undefined) body.attachments = input.attachments;
  await client.post(`/threads/${input.threadId}/messages`, body, { context: 'user' });
  return { sent: true };
};
