import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  root(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
