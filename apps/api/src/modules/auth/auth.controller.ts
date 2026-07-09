import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { DomainError } from '../../errors/domain.error.js';

import { AuthService } from './auth.service.js';
import { Public } from './decorators/public.decorator.js';
import { LoginDto, loginSchema } from './dto/login.dto.js';
import { SessionService } from './session.service.js';

import type { AuthUserResponse } from './dto/auth-response.dto.js';
import type { Request, Response } from 'express';

const SESSION_COOKIE = 'session';
const CSRF_COOKIE = 'csrf_token';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUserResponse> {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw parsed.error;
    const user = await this.authService.verifyCredentials(parsed.data.email, parsed.data.password);
    const created = await this.sessions.create({
      userId: user.id,
      userAgent: req.headers['user-agent'] ?? null,
      ipAddress: req.ip ?? null,
    });
    const maxAge = Math.floor((created.expiresAt.getTime() - Date.now()) / 1000);
    res.cookie(SESSION_COOKIE, created.rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: maxAge * 1000,
    });
    res.cookie(CSRF_COOKIE, created.csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: maxAge * 1000,
    });
    return { user: { id: user.id, email: user.email, role: user.role } };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    if (req.sessionContext) {
      await this.sessions.revoke(req.sessionContext.session.id);
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
  }

  @Public()
  @Get('me')
  me(@Req() req: Request): AuthUserResponse {
    if (!req.sessionContext) {
      throw DomainError.unauthorized();
    }
    const u = req.sessionContext.user;
    return { user: { id: u.id, email: u.email, role: u.role } };
  }
}
