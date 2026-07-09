import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { ApiKeyService } from './api-key.service.js';
import { ApiKeysController } from './api-keys.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CsrfMiddleware } from './csrf.middleware.js';
import { AuthGuard } from './guards/auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { SessionMiddleware } from './session.middleware.js';
import { SessionService } from './session.service.js';

@Module({
  controllers: [AuthController, ApiKeysController],
  providers: [
    AuthService,
    SessionService,
    SessionMiddleware,
    CsrfMiddleware,
    ApiKeyService,
    AuthGuard,
    RolesGuard,
  ],
  exports: [SessionService, AuthService, ApiKeyService, AuthGuard, RolesGuard],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionMiddleware).forRoutes('*');
    consumer.apply(CsrfMiddleware).forRoutes('*');
  }
}
