import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { DomainError } from '../../../errors/domain.error.js';
import { ApiKeyService } from '../api-key.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

import type { Request } from 'express';

declare module 'express' {
  interface Request {
    apiKey?: { keyId: string; userId: string; scopes: string[] };
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();

    // Public Swagger UI + OpenAPI JSON
    if (req.path?.startsWith('/api-docs') === true) return true;

    // Bearer API key — o cheie validă poate face orice acțiune, fără restricție de scope.
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const key = auth.slice('Bearer '.length).trim();
      const ctx = await this.apiKeys.findActive(key);
      if (!ctx) throw DomainError.unauthorized('Invalid API key');
      req.apiKey = ctx;
      return true;
    }

    // Session cookie
    if (req.sessionContext) {
      return true;
    }

    throw DomainError.unauthorized();
  }
}
