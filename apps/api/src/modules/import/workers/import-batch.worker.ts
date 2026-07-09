import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

import { JobQueueService } from '../../../jobs/job-queue.service.js';
import { ImportBatchService } from '../import-batch.service.js';
import { IMPORT_BATCH_JOB, type ImportBatchJob } from '../push-jobs.js';

@Injectable()
export class ImportBatchWorker implements OnApplicationBootstrap {
  constructor(
    private readonly queue: JobQueueService,
    private readonly batches: ImportBatchService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.queue.register<ImportBatchJob>(IMPORT_BATCH_JOB, (data) =>
      this.batches.executeBatch(data.batchId),
    );
  }
}
