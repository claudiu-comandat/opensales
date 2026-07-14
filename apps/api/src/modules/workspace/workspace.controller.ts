import { Body, Controller, Get, HttpCode, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { type schema } from '@opensales/db';
import { z } from 'zod';

import { Roles } from '../auth/decorators/roles.decorator.js';

import { WorkspaceService, type WorkspaceUpdate } from './workspace.service.js';

const updateWorkspaceSchema = z.object({
  companyName: z.string().min(1).optional(),
  contactPerson: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  awbPhone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  street: z.string().nullable().optional(),
  vatId: z.string().nullable().optional(),
  vatPayer: z.boolean().optional(),
  registrationNumber: z.string().nullable().optional(),
  country: z.string().optional(),
  county: z.string().nullable().optional(),
  prelistValidatedWebhookUrl: z.string().url().nullable().optional(),
});

@ApiTags('Workspace')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly service: WorkspaceService) {}

  @Get()
  @Roles('admin', 'operator')
  async get(): Promise<schema.Workspace> {
    return this.service.get();
  }

  @Patch()
  @HttpCode(200)
  @Roles('admin')
  async update(@Body() body: unknown): Promise<schema.Workspace> {
    const data = updateWorkspaceSchema.parse(body);
    // Cast: Zod .optional() produces `T | undefined` explicitly, which is incompatible
    // with Partial<> under exactOptionalPropertyTypes. The values are structurally identical.
    return this.service.upsert(data as WorkspaceUpdate);
  }
}
