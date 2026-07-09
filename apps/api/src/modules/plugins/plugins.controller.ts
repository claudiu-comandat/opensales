import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import type { schema } from '@opensales/db';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { zodPipe } from '../products/pipes/zod-validation.pipe.js';

import { PluginLifecycleService } from './lifecycle/plugin-lifecycle.service.js';
import { PluginRegistryService } from './registry/plugin-registry.service.js';

type PluginRow = schema.Plugin;

function toResponse(row: PluginRow) {
  return {
    id: row.id,
    packageName: row.packageName,
    version: row.version,
    displayName: row.displayName ?? undefined,
    status: row.status,
    manifest: row.manifest ?? undefined,
    grantedPermissions: row.grantedPermissions,
    lastError: row.lastError ?? null,
    lastHealthCheckAt: row.lastHealthCheckAt?.toISOString() ?? null,
    installedAt: row.installedAt.toISOString(),
    config: row.config,
  };
}

@ApiTags('Plugins')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller('plugins')
export class PluginsController {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly lifecycle: PluginLifecycleService,
  ) {}

  @Get()
  @Roles('admin', 'operator')
  async list(): Promise<{ data: ReturnType<typeof toResponse>[] }> {
    const rows = await this.registry.list();
    return { data: rows.map(toResponse) };
  }

  @Get(':id')
  @Roles('admin', 'operator')
  async get(@Param('id') id: string): Promise<ReturnType<typeof toResponse>> {
    const row = await this.registry.findById(id);
    if (!row) throw new NotFoundException('Plugin not found');
    return toResponse(row);
  }

  @Post(':id/configure')
  @HttpCode(200)
  @Roles('admin')
  async configure(
    @Param('id') id: string,
    @Body() body: { secrets?: Record<string, unknown>; config?: Record<string, unknown> },
  ): Promise<{ ok: boolean }> {
    await this.lifecycle.configure(id, body);
    return { ok: true };
  }

  @Post(':id/verify')
  @HttpCode(200)
  @Roles('admin')
  async verify(@Param('id') id: string): Promise<{ ok: boolean; reason?: string }> {
    return this.lifecycle.verify(id);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @Roles('admin')
  async enable(@Param('id') id: string): Promise<{ ok: boolean }> {
    await this.lifecycle.enable(id);
    return { ok: true };
  }

  @Post(':id/disable')
  @HttpCode(200)
  @Roles('admin')
  async disable(@Param('id') id: string): Promise<{ ok: boolean }> {
    await this.lifecycle.disable(id);
    return { ok: true };
  }

  @Delete(':id')
  @HttpCode(200)
  @Roles('admin')
  async uninstall(@Param('id') id: string): Promise<{ ok: boolean }> {
    await this.lifecycle.uninstall(id);
    return { ok: true };
  }

  @Get(':id/webhook-info')
  @Roles('admin')
  async webhookInfo(
    @Param('id') id: string,
  ): Promise<{ callbackUrl: string | null; token: string }> {
    return this.lifecycle.getWebhookInfo(id);
  }

  @Post(':id/register-callback')
  @HttpCode(200)
  @Roles('admin')
  async registerCallback(
    @Param('id') id: string,
  ): Promise<{ ok: boolean; error?: string; callbackUrl: string | null }> {
    return this.lifecycle.registerCallbackOnEmag(id);
  }

  @Post(':id/awb-callback-configured')
  @HttpCode(200)
  @Roles('admin')
  async markAwbCallbackConfigured(
    @Param('id') id: string,
    @Body(zodPipe(z.object({ configured: z.boolean() }))) body: { configured: boolean },
  ): Promise<{ ok: boolean }> {
    await this.lifecycle.setAwbCallbackConfigured(id, body.configured);
    return { ok: true };
  }
}
