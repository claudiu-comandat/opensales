import 'reflect-metadata';

// Minimal env for integration tests that boot AppModule
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5433/opensales_test';
process.env.PLATFORM_MASTER_KEY ??= 'a'.repeat(64);
process.env.SESSION_SECRET ??= 'b'.repeat(64);
process.env.NODE_ENV ??= 'test';
