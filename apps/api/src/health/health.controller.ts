import { Controller, Get } from '@nestjs/common';

import { Public } from '../modules/auth/decorators/public.decorator.js';

interface HealthResponse {
  status: 'ok';
  uptime: number;
}
interface ReadyResponse {
  status: 'ready';
  checks: { db: 'pending' };
}

@Controller()
export class HealthController {
  @Public()
  @Get('healthz')
  liveness(): HealthResponse {
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }

  // TODO(T1.13): replace stub with real DB readiness check using DrizzleClient
  @Public()
  @Get('readyz')
  readiness(): ReadyResponse {
    return { status: 'ready', checks: { db: 'pending' } };
  }
}
