import { Injectable } from '@nestjs/common';

import { ConfigService } from '../../config/config.service.js';

/**
 * Thin wrapper over `PLATFORM_MASTER_KEY` (env-only by design).
 *
 * We require operators to set this env var explicitly so the encryption key
 * never lives inside the same DB it protects. If the env var is missing or
 * malformed, the API refuses to start — see `env.schema.ts` for the regex.
 *
 * Generate one with: `openssl rand -hex 32`. Pin it in Railway/your secret
 * manager and NEVER rotate it without first re-configuring every plugin —
 * a new key cannot decrypt existing ciphertext.
 */
@Injectable()
export class MasterKeyService {
  constructor(private readonly config: ConfigService) {}

  get key(): string {
    return this.config.platformMasterKey;
  }
}
