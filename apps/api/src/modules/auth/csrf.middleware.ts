import { timingSafeEqual } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';

import { DomainError } from '../../errors/domain.error.js';

import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT_PATHS = new Set(['/auth/login', '/healthz', '/readyz']);
const HEADER = 'x-csrf-token';
const COOKIE = 'csrf_token';

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const requestPath = (req.originalUrl ?? req.path).split('?')[0] ?? '';
    if (EXEMPT_PATHS.has(requestPath)) {
      next();
      return;
    }

    // Skip CSRF if request is API-key authenticated (Bearer header).
    if (req.headers.authorization?.startsWith('Bearer ')) {
      next();
      return;
    }

    const headerToken = req.headers[HEADER];
    const cookieToken = req.cookies?.[COOKIE] as unknown;
    const sessionCsrf = req.sessionContext?.session.csrfToken;

    if (
      typeof headerToken !== 'string' ||
      typeof cookieToken !== 'string' ||
      typeof sessionCsrf !== 'string'
    ) {
      throw DomainError.forbidden('CSRF token missing');
    }

    if (!safeEqual(headerToken, cookieToken) || !safeEqual(headerToken, sessionCsrf)) {
      throw DomainError.forbidden('CSRF token mismatch');
    }

    next();
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
