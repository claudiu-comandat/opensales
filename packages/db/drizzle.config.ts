import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: [
    './src/schema/users.ts',
    './src/schema/products.ts',
    './src/schema/plugins.ts',
    './src/schema/api-keys.ts',
    './src/schema/listings.ts',
    './src/schema/orders.ts',
    './src/schema/order-items.ts',
    './src/schema/plugin-request-log.ts',
    './src/schema/sessions.ts',
    './src/schema/stock-contributions.ts',
  ],
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://opensales:opensales@localhost:5432/opensales',
  },
  strict: true,
  verbose: true,
});
