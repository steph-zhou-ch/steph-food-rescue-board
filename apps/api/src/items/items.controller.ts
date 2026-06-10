// REQ-CAP-* :: REST controller for surplus items.
//
// Routes:
//   POST   /api/items             create (201)
//   GET    /api/items             browse feed (200)
//   GET    /api/items/:id         detail, any status (200 / 404)
//   PATCH  /api/items/:id/status  claim | unclaim | confirm_pickup
//   DELETE /api/items/:id         soft-remove (200 / 404, idempotent)
//
// Validation is enforced by ZodValidationPipe at the boundary so bad
// input is rejected with 400 before reaching storage.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { createItemSchema, type CreateItemDto } from './dto/create-item.dto.js';
import { listQuerySchema, type ListQueryDto } from './dto/list-query.dto.js';
import {
  updateStatusSchema,
  type UpdateStatusDto,
} from './dto/update-status.dto.js';
import { ItemsService } from './items.service.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

@Controller('api/items')
export class ItemsController {
  constructor(
    @Inject(ItemsService) private readonly items: ItemsService,
  ) {}

  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createItemSchema)) body: CreateItemDto,
  ): { id: string; status: 'available'; createdAt: string } {
    return this.items.create(body);
  }

  @Get()
  @HttpCode(200)
  list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQueryDto,
  ): ReturnType<ItemsService['list']> {
    return this.items.list(query);
  }

  @Get(':id')
  @HttpCode(200)
  getById(@Param('id') id: string): ReturnType<ItemsService['getById']> {
    return this.items.getById(id);
  }

  @Patch(':id/status')
  @HttpCode(200)
  updateStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStatusSchema)) body: UpdateStatusDto,
  ): ReturnType<ItemsService['updateStatus']> {
    return this.items.updateStatus(id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string): { id: string; status: 'removed' } {
    return this.items.remove(id);
  }
}
