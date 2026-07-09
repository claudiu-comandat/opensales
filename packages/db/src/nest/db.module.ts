import { Module } from '@nestjs/common';

import { createDb } from '../client.js';

import { DB_TOKEN } from './db.token.js';

import type { DynamicModule } from '@nestjs/common';

@Module({})
export class DbModule {
  static forRoot(databaseUrl: string): DynamicModule {
    return {
      module: DbModule,
      global: true,
      providers: [
        {
          provide: DB_TOKEN,
          useFactory: () => createDb(databaseUrl).db,
        },
      ],
      exports: [DB_TOKEN],
    };
  }
}
