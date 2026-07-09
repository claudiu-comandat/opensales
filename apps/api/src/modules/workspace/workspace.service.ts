import { Inject, Injectable } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';

/** Fixed singleton ID — one workspace row per installation. */
const WORKSPACE_ID = '018f4d6c-a000-7000-b000-000000000001';

const WORKSPACE_DEFAULTS = {
  companyName: '',
  contactPerson: null as string | null,
  phone: null as string | null,
  awbPhone: null as string | null,
  email: null as string | null,
  street: null as string | null,
  vatId: null as string | null,
  registrationNumber: null as string | null,
  country: 'România',
  county: null as string | null,
  prelistValidatedWebhookUrl: null as string | null,
};

export type WorkspaceUpdate = Partial<typeof WORKSPACE_DEFAULTS>;

@Injectable()
export class WorkspaceService {
  constructor(@Inject(DB_TOKEN) private readonly db: Database) {}

  async get(): Promise<schema.Workspace> {
    const row = await this.db.query.workspace.findFirst();
    if (row) return row;
    // Auto-initialize on first access with empty defaults
    return this.upsert({});
  }

  async upsert(data: WorkspaceUpdate): Promise<schema.Workspace> {
    const now = new Date();
    const rows = await this.db
      .insert(schema.workspace)
      .values({ id: WORKSPACE_ID, ...WORKSPACE_DEFAULTS, ...data, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.workspace.id,
        set: { ...data, updatedAt: now },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Workspace upsert returned no rows');
    return row;
  }
}
