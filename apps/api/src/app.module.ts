import { Module } from '@nestjs/common';

import { ItemsModule } from './items/items.module.js';

/**
 * Root NestJS module. Capability tracks add their feature modules
 * here. The w1-api-items track wires the surplus-items capability
 * (POST/GET/PATCH/DELETE /api/items) with its real in-memory store
 * and SystemClock — no placeholder providers.
 */
@Module({
  imports: [ItemsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
