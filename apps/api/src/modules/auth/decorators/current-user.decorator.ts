import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { DomainError } from '../../../errors/domain.error.js';

import type { SessionUser } from '../types.js';
import type { Request } from 'express';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.sessionContext) throw DomainError.unauthorized();
    return req.sessionContext.user;
  },
);
