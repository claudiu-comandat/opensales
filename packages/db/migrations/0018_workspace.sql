CREATE TABLE "workspace" (
  "id" uuid PRIMARY KEY NOT NULL,
  "company_name" text NOT NULL DEFAULT '',
  "contact_person" text,
  "phone" text,
  "awb_phone" text,
  "email" text,
  "street" text,
  "vat_id" text,
  "registration_number" text,
  "country" text NOT NULL DEFAULT 'România',
  "county" text,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
