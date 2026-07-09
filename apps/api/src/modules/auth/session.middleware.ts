import { Inject, Injectable, NestMiddleware } from '@nestjs/common';

import { SessionService } from './session.service.js';

import type { NextFunction, Request, Response } from 'express';

const SESSION_COOKIE = 'session';

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const token = req.cookies?.[SESSION_COOKIE] as unknown;
    if (typeof token === 'string' && token.length > 0) {
      const found = await this.sessions.findActive(token);
      if (found) {
        req.sessionContext = {
          user: { id: found.user.id, email: found.user.email, role: found.user.role },
          session: found.session,
        };
        // fire-and-forget touch
        void this.sessions.touch(found.session.id);
      }
    }
    next();
  }
}
