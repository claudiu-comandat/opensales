import { join } from 'node:path';

import { Injectable } from '@nestjs/common';

import { parseEnv } from './env.schema.js';

import type { Env } from './env.schema.js';

@Injectable()
export class ConfigService {
  private readonly env: Env;

  constructor(rawEnv: NodeJS.ProcessEnv = process.env) {
    this.env = parseEnv(rawEnv);
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.env.NODE_ENV;
  }

  get port(): number {
    return this.env.PORT;
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get logLevel(): Env['LOG_LEVEL'] {
    return this.env.LOG_LEVEL;
  }

  get platformMasterKey(): string {
    return this.env.PLATFORM_MASTER_KEY;
  }

  get sessionSecret(): string {
    return this.env.SESSION_SECRET;
  }

  get sessionTtlHours(): number {
    return this.env.SESSION_TTL_HOURS;
  }

  get pluginsRoot(): string {
    return process.env.PLUGINS_ROOT ?? join(process.cwd(), 'plugins');
  }

  get initialAdmin(): { email: string; password: string } | null {
    if (!this.env.INITIAL_ADMIN_EMAIL || !this.env.INITIAL_ADMIN_PASSWORD) return null;
    return { email: this.env.INITIAL_ADMIN_EMAIL, password: this.env.INITIAL_ADMIN_PASSWORD };
  }

  get publicApiUrl(): string | undefined {
    // RAILWAY_STATIC_URL is auto-injected by Railway as the public service URL.
    // It works as a zero-config fallback so users don't need to set PUBLIC_API_URL manually.
    return this.env.PUBLIC_API_URL ?? process.env.RAILWAY_STATIC_URL;
  }

  isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }
}
