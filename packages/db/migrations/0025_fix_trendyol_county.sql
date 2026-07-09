-- Fix billing_address.county and shipping_address.county for existing Trendyol orders.
-- The mapper was using invoiceAddress.district (locality name, e.g. "Floresti") instead of
-- invoiceAddress.countyName (actual Romanian judet, e.g. "Cluj").
-- raw_payload stores the original Trendyol JSON so we can re-derive the correct value.

UPDATE orders
SET
  billing_address = CASE
    WHEN billing_address IS NOT NULL
      AND raw_payload -> 'invoiceAddress' ->> 'countyName' IS NOT NULL
      AND raw_payload -> 'invoiceAddress' ->> 'countyName' <> ''
    THEN jsonb_set(
      billing_address,
      '{county}',
      to_jsonb(raw_payload -> 'invoiceAddress' ->> 'countyName')
    )
    ELSE billing_address
  END,
  shipping_address = CASE
    WHEN shipping_address IS NOT NULL
      AND raw_payload -> 'shipmentAddress' ->> 'countyName' IS NOT NULL
      AND raw_payload -> 'shipmentAddress' ->> 'countyName' <> ''
    THEN jsonb_set(
      shipping_address,
      '{county}',
      to_jsonb(raw_payload -> 'shipmentAddress' ->> 'countyName')
    )
    ELSE shipping_address
  END,
  updated_at = NOW()
WHERE
  marketplace LIKE 'trendyol-%'
  AND raw_payload IS NOT NULL;
