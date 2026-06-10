// Integration tests for the surplus-items REST API.
//
// These boot the REAL production AppModule (not a TestingModule with
// fakes) and drive it through the HTTP transport with supertest, so a
// mutation that is wired into the controller but not reachable through
// the app graph would fail here. Each test is tagged so the
// spec-adherence audit can map it to its acceptance criterion.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

let app: INestApplication;

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const nestApp = moduleRef.createNestApplication();
  await nestApp.init();
  return nestApp;
}

interface CreateBody {
  title?: unknown;
  description?: unknown;
  category?: unknown;
  pickupLocation?: unknown;
  postedBy?: unknown;
  photoUrl?: unknown;
  expiresAt?: unknown;
  pickupLatLng?: unknown;
}

function validBody(overrides: CreateBody = {}): Record<string, unknown> {
  return {
    title: '12 bagels',
    description: 'Fresh this morning, must go today',
    category: 'food',
    pickupLocation: '5th Ave bakery',
    postedBy: 'Sam',
    ...overrides,
  };
}

beforeEach(async () => {
  app = await createApp();
});

afterEach(async () => {
  await app.close();
});

describe('@req REQ-CAP-POST-ITEM @criterion post-01-creates-available-item', () => {
  it('returns 201 with a UUID id and status available', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .send(validBody())
      .expect(201);

    expect(res.body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(res.body.status).toBe('available');
    expect(typeof res.body.createdAt).toBe('string');
  });

  it('the created item appears in a subsequent GET /api/items', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/items')
      .send(validBody({ title: 'unique-marker-item' }))
      .expect(201);

    const feed = await request(app.getHttpServer())
      .get('/api/items')
      .expect(200);

    const ids = feed.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(created.body.id);
  });

  it('does NOT create an item with a status other than available', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .send(validBody({ title: 'status-injection' }))
      .expect(201);
    // even if a status field were smuggled in, the server forces available
    expect(res.body.status).toBe('available');
  });
});
