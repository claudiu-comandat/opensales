import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Singleton workspace row — one per installation.
 * Stores business profile data used on invoices, AWBs and emails.
 */
export const workspace = pgTable('workspace', {
  id: uuid('id').primaryKey().notNull(),
  companyName: text('company_name').notNull().default(''),
  /** Persoana de contact — folosită ca sender.contact pe AWB-uri. */
  contactPerson: text('contact_person'),
  phone: text('phone'),
  /** Număr de telefon dedicat AWB-urilor. Dacă e completat, înlocuiește phone pe AWB. */
  awbPhone: text('awb_phone'),
  email: text('email'),
  /** Stradă — folosită ca sender.street pe AWB-uri. */
  street: text('street'),
  vatId: text('vat_id'),
  /** Plătitor de TVA. Neplătitor (default) → forțează TVA 0% la trimiterea ofertelor pe marketplace-uri, indiferent de `products.vatRate`. */
  vatPayer: boolean('vat_payer').notNull().default(false),
  registrationNumber: text('registration_number'),
  country: text('country').notNull().default('România'),
  county: text('county'),
  /**
   * URL-ul procesului extern notificat când un produs prelistat e validat de eMAG
   * (cu categoria/caracteristicile atribuite). Null = fără notificare.
   */
  prelistValidatedWebhookUrl: text('prelist_validated_webhook_url'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Workspace = typeof workspace.$inferSelect;
export type NewWorkspace = typeof workspace.$inferInsert;
