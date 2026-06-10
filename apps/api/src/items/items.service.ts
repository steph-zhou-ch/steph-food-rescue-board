// REQ-CAP-* :: application service for surplus items. Bridges the
// HTTP boundary and the pure application/domain layers:
//   - generates ids (uuid) and reads "now" via the Clock port (never
//     `new Date()` / `Date.now()` — forbidden by REQ-INV-TIMEZONE-DST)
//   - maps domain errors to HTTP status codes (404 / 409 / 400)
//   - serializes domain entities to the wire shape (ISO-8601 Z dates)

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

import {
  ItemNotFoundError,
  ItemStore,
} from '@app/application';
import {
  TransitionError,
  type ItemAction,
  type SurplusItem,
} from '@app/domain';
import type { Clock } from '@app/shared-kernel';

import { CLOCK, ITEM_STORE } from './items.tokens.js';
import type { CreateItemDto } from './dto/create-item.dto.js';
import type { ListQueryDto } from './dto/list-query.dto.js';
import type { UpdateStatusDto } from './dto/update-status.dto.js';

/** Wire-shape of a SurplusItem (dates as ISO-8601 Z strings). */
export interface SurplusItemWire {
  id: string;
  title: string;
  description: string;
  photoUrl: string | null;
  category: SurplusItem['category'];
  pickupLocation: string;
  pickupLatLng: { lat: number; lng: number } | null;
  postedBy: string;
  status: SurplusItem['status'];
  claimedBy: string | null;
  createdAt: string;
  expiresAt: string | null;
}

@Injectable()
export class ItemsService {
  constructor(
    @Inject(ITEM_STORE) private readonly store: ItemStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  create(dto: CreateItemDto): {
    id: string;
    status: 'available';
    createdAt: string;
  } {
    const now = this.clock.now();
    const item = this.store.create(
      {
        title: dto.title,
        description: dto.description,
        category: dto.category,
        pickupLocation: dto.pickupLocation,
        postedBy: dto.postedBy,
        photoUrl: dto.photoUrl,
        pickupLatLng: dto.pickupLatLng,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
      uuidv4(),
      now,
    );
    return {
      id: item.id,
      status: 'available',
      createdAt: item.createdAt.toISOString(),
    };
  }

  list(query: ListQueryDto): { items: SurplusItemWire[] } {
    const items = this.store.list({
      category: query.category,
      now: this.clock.now(),
    });
    return { items: items.map((i) => this.toWire(i)) };
  }

  getById(id: string): SurplusItemWire {
    const item = this.store.getById(id);
    if (item === null) {
      throw new NotFoundException(`Item not found: ${id}`);
    }
    return this.toWire(item);
  }

  updateStatus(
    id: string,
    dto: UpdateStatusDto,
  ): { id: string; status: SurplusItem['status']; claimedBy: string | null } {
    try {
      const updated = this.store.applyAction(
        id,
        dto.action as Exclude<ItemAction, 'remove'>,
        dto.claimedBy ?? null,
      );
      return {
        id: updated.id,
        status: updated.status,
        claimedBy: updated.claimedBy,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  remove(id: string): { id: string; status: 'removed' } {
    try {
      const updated = this.store.remove(id);
      return { id: updated.id, status: 'removed' };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  private mapError(err: unknown): Error {
    if (err instanceof ItemNotFoundError) {
      return new NotFoundException(err.message);
    }
    if (err instanceof TransitionError) {
      return new ConflictException(err.message);
    }
    return err instanceof Error ? err : new Error('Unknown error');
  }

  private toWire(item: SurplusItem): SurplusItemWire {
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      photoUrl: item.photoUrl,
      category: item.category,
      pickupLocation: item.pickupLocation,
      pickupLatLng: item.pickupLatLng,
      postedBy: item.postedBy,
      status: item.status,
      claimedBy: item.claimedBy,
      createdAt: item.createdAt.toISOString(),
      expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
    };
  }
}
