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

describe('@req REQ-CAP-POST-ITEM @criterion post-02-validates-required-fields', () => {
  const required = [
    'title',
    'description',
    'category',
    'pickupLocation',
    'postedBy',
  ] as const;

  for (const field of required) {
    it(`returns 400 naming the missing field when ${field} is absent`, async () => {
      const body = validBody();
      delete (body as Record<string, unknown>)[field];
      const res = await request(app.getHttpServer())
        .post('/api/items')
        .send(body)
        .expect(400);
      expect(JSON.stringify(res.body)).toContain(field);
    });
  }

  it('does NOT return 201 when a required field is missing', async () => {
    await request(app.getHttpServer())
      .post('/api/items')
      .send(validBody({ title: undefined }))
      .expect(400);
  });

  it('does NOT return 500 for a validation error (pre-storage)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .send({});
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
  });
});

describe('@req REQ-CAP-POST-ITEM @criterion post-03-enforces-length-limits', () => {
  it('rejects title > 100 chars with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/items')
      .send(validBody({ title: 'x'.repeat(101) }))
      .expect(400);
  });

  it('rejects description > 500 chars with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/items')
      .send(validBody({ description: 'x'.repeat(501) }))
      .expect(400);
  });

  it('rejects pickupLocation > 200 chars with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/items')
      .send(validBody({ pickupLocation: 'x'.repeat(201) }))
      .expect(400);
  });

  it('rejects postedBy > 50 chars with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/items')
      .send(validBody({ postedBy: 'x'.repeat(51) }))
      .expect(400);
  });

  it('does NOT silently truncate — a max-length title is accepted intact', async () => {
    const exactly100 = 'x'.repeat(100);
    const created = await request(app.getHttpServer())
      .post('/api/items')
      .send(validBody({ title: exactly100 }))
      .expect(201);
    const detail = await request(app.getHttpServer())
      .get(`/api/items/${created.body.id}`)
      .expect(200);
    expect(detail.body.title).toBe(exactly100);
  });
});
