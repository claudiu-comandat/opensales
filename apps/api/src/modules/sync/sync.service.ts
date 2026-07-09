import { Injectable } from '@nestjs/common';

import { PollAwbStatusWorker } from './workers/poll-awb-status.worker.js';
import { SyncListingsWorker } from './workers/sync-listings.worker.js';
import { SyncOrdersWorker } from './workers/sync-orders.worker.js';

@Injectable()
export class SyncService {
  constructor(
    private readonly orders: SyncOrdersWorker,
    private readonly listings: SyncListingsWorker,
    private readonly awbPoll: PollAwbStatusWorker,
  ) {}

  enqueueOrders(pluginId: string): Promise<string | null> {
    return this.orders.enqueue(pluginId);
  }

  enqueueListings(pluginId: string): Promise<string | null> {
    return this.listings.enqueue(pluginId);
  }

  enqueueAwbPoll(pluginId: string): Promise<string | null> {
    return this.awbPoll.enqueue(pluginId);
  }
}
