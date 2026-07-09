import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import PgBoss from 'pg-boss';

import { ConfigService } from '../config/config.service.js';

export type JobHandler<T> = (data: T) => Promise<void>;

@Injectable()
export class JobQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly boss: PgBoss;
  private started = false;

  constructor(private readonly config: ConfigService) {
    this.boss = new PgBoss({
      connectionString: this.config.databaseUrl,
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.config.isTest()) return;
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 5000 });
  }

  async start(): Promise<void> {
    await this.boss.start();
    this.started = true;
  }

  async enqueue<T extends object>(
    name: string,
    data: T,
    opts?: PgBoss.SendOptions,
  ): Promise<string | null> {
    // boss.start() nu rulează în test (vezi onModuleInit), deci fără schema
    // pg-boss send() ar crash-ui — DOAR dacă nimeni nu a pornit-o explicit
    // (job-queue.service.test.ts o face, ca să verifice round-trip-ul real).
    if (!this.started) return null;
    if (opts !== undefined) {
      return this.boss.send(name, data, opts);
    }
    return this.boss.send(name, data);
  }

  async register<T extends object>(name: string, handler: JobHandler<T>): Promise<void> {
    await this.boss.createQueue(name);
    await this.boss.work<T>(name, async (jobs) => {
      for (const job of jobs) {
        await handler(job.data);
      }
    });
  }

  async registerBatch<T extends object>(
    name: string,
    handler: (data: T[]) => Promise<void>,
    batchSize = 100,
  ): Promise<void> {
    await this.boss.createQueue(name);
    await this.boss.work<T>(name, { batchSize }, async (jobs) => {
      await handler(jobs.map((j) => j.data));
    });
  }

  raw(): PgBoss {
    return this.boss;
  }
}
