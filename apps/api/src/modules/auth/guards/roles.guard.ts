import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { DomainError } from '../../../errors/domain.error.js';
import { ROLES_KEY, type Role } from '../decorators/roles.decorator.js';

import type { Request } from 'express';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    // For API key requests, role check is bypassed (scopes handle it).
    if (req.apiKey) return true;

    const role = req.sessionContext?.user.role;
    if (!role) throw DomainError.unauthorized();
    if (!required.includes(role)) throw DomainError.forbidden('Insufficient role');
    return true;
  }
}
