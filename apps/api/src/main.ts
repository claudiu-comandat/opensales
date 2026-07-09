// v0.1.1
import { NestFactory, Reflector } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { installLoggingFetch } from '@opensales/plugin-sdk';
import cookieParser from 'cookie-parser';
import { Logger, PinoLogger } from 'nestjs-pino';
import { patchNestJsSwagger } from 'nestjs-zod';

import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './errors/all-exceptions.filter.js';
import { ApiKeyService } from './modules/auth/api-key.service.js';
import { AuthGuard } from './modules/auth/guards/auth.guard.js';
import { RolesGuard } from './modules/auth/guards/roles.guard.js';

patchNestJsSwagger();

// Patch global fetch so every outbound request a plugin makes during an action
// is auto-recorded for the debug UI. No-op outside plugin action scope.
installLoggingFetch();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  // Ridicăm limita parserului implicit (100kb) la 25MB prin API-ul Nest, fără a
  // importa `express` direct — importurile mari (până la 5000 de produse) ar fi
  // altfel respinse cu 413.
  app.useBodyParser('json', { limit: '25mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '25mb' });
  app.use(cookieParser());
  app.useLogger(app.get(Logger));
  const pinoLogger = await app.resolve(PinoLogger);
  app.useGlobalFilters(new AllExceptionsFilter(pinoLogger));

  const reflector = app.get(Reflector);
  const apiKeyService = app.get(ApiKeyService);
  app.useGlobalGuards(new AuthGuard(reflector, apiKeyService), new RolesGuard(reflector));

  const docConfig = new DocumentBuilder()
    .setTitle('OpenSales API')
    .setDescription('OpenSales platform HTTP API.')
    .setVersion(process.env.PLATFORM_VERSION ?? '0.1.0')
    .addCookieAuth('session', { type: 'apiKey', in: 'cookie', name: 'session' })
    .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'apiKey')
    .build();
  const doc = SwaggerModule.createDocument(app, docConfig);
  SwaggerModule.setup('api-docs', app, doc, { jsonDocumentUrl: 'api-docs-json' });

  const port = Number(process.env.PORT ?? 3001);
  // Explicit 0.0.0.0 bind — required by Railway/Fly/Render proxy reachability.
  // Without it, Express defaults to IPv6 wildcard which some platforms can't reach.
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);
  app.get(Logger).log(`API listening on http://${host}:${port}`, 'Bootstrap');
  app.get(Logger).log(`Healthcheck: GET /healthz · Swagger: GET /api-docs`, 'Bootstrap');
}

void bootstrap();
