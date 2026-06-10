// REQ-CAP-* :: NestJS module wiring the items capability with REAL
// production providers — the in-memory ItemStore (singleton) and the
// SystemClock binding for the Clock port. No placeholder/throwing
// stubs: this module is import-ready for AppModule.

import { Module } from '@nestjs/common';

import { ItemStore } from '@app/application';
import { SystemClock } from '@app/shared-kernel';

import { ItemsController } from './items.controller.js';
import { ItemsService } from './items.service.js';
import { CLOCK, ITEM_STORE } from './items.tokens.js';

@Module({
  controllers: [ItemsController],
  providers: [
    ItemsService,
    { provide: ITEM_STORE, useFactory: (): ItemStore => new ItemStore() },
    { provide: CLOCK, useClass: SystemClock },
  ],
  exports: [ItemsService],
})
export class ItemsModule {}
