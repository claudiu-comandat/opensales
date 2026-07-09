import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';

import { DomainError } from '../../errors/domain.error.js';

import { ApiKeyService } from './api-key.service.js';
import { Roles } from './decorators/roles.decorator.js';

import type { Request } from 'express';

export interface ApiKeyResponse {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  /** Prezent doar imediat după creare/rotire — nu se poate recupera ulterior. */
  rawKey?: string;
}

@ApiTags('API Keys')
@ApiCookieAuth('session')
@Roles('admin')
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Get()
  async list(@Req() req: Request): Promise<ApiKeyResponse[]> {
    const userId = req.sessionContext?.user.id;
    if (!userId) throw DomainError.unauthorized();
    const keys = await this.apiKeyService.listForUser(userId);
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.keyPrefix,
      scopes: k.scopes,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    }));
  }

  @Post()
  async create(@Req() req: Request): Promise<ApiKeyResponse> {
    const userId = req.sessionContext?.user.id;
    if (!userId) throw DomainError.unauthorized();
    const { key, rawKey } = await this.apiKeyService.createForUser(userId, 'Cheie principală');
    return {
      id: key.id,
      name: key.name,
      prefix: key.keyPrefix,
      scopes: key.scopes,
      createdAt: key.createdAt.toISOString(),
      lastUsedAt: null,
      rawKey,
    };
  }

  @Post(':id/rotate')
  async rotate(@Param('id') id: string, @Req() req: Request): Promise<ApiKeyResponse> {
    const userId = req.sessionContext?.user.id;
    if (!userId) throw DomainError.unauthorized();
    const { key, rawKey } = await this.apiKeyService.rotateKey(id, userId);
    return {
      id: key.id,
      name: key.name,
      prefix: key.keyPrefix,
      scopes: key.scopes,
      createdAt: key.createdAt.toISOString(),
      lastUsedAt: null,
      rawKey,
    };
  }
}
