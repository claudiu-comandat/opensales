/**
 * NestJS standalone DI bootstrap for the CLI.
 *
 * Uses `NestFactory.createApplicationContext` so we never bind an HTTP listener;
 * the CLI just resolves services from the DI graph.
 *
 * The concrete `AppModule` import is intentionally lazy: T2.20 / T2.21 will
 * wire it up once the CLI starts resolving registry / lifecycle services.
 * Keeping it lazy means `pnpm --filter @opensales/cli typecheck` does not
 * require `apps/api` to be present in the cli's tsconfig graph and avoids
 * pulling `@nestjs/common` types into this workspace prematurely.
 */

export interface ApplicationContextLike {
  close(): Promise<void>;
}

let cached: ApplicationContextLike | null = null;

export interface CreateContextOptions {
  /**
   * Override the NestJS module factory. Used by tests to inject a stub module
   * without pulling in the full `apps/api` graph. T2.20+ will provide the
   * real factory that calls `NestFactory.createApplicationContext(AppModule)`.
   */
  moduleFactory?: () => Promise<ApplicationContextLike>;
}

export async function createApplicationContext(
  options: CreateContextOptions = {},
): Promise<ApplicationContextLike> {
  if (cached) return cached;
  if (!options.moduleFactory) {
    throw new Error(
      'createApplicationContext: no moduleFactory provided. T2.20+ will wire AppModule here.',
    );
  }
  cached = await options.moduleFactory();
  return cached;
}

export async function disposeApplicationContext(): Promise<void> {
  if (cached) {
    await cached.close();
    cached = null;
  }
}
