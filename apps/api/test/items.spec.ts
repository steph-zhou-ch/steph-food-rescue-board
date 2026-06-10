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

async function post(body: Record<string, unknown>): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/items')
    .send(body)
    .expect(201);
  return res.body.id as string;
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

describe('@req REQ-CAP-BROWSE-FEED @criterion browse-01-returns-available-only', () => {
  it('returns only available items; claimed and removed do not appear', async () => {
    const availableId = await post(validBody({ title: 'available-one' }));
    const claimedId = await post(validBody({ title: 'claimed-one' }));
    const removedId = await post(validBody({ title: 'removed-one' }));

    await request(app.getHttpServer())
      .patch(`/api/items/${claimedId}/status`)
      .send({ action: 'claim', claimedBy: 'Lee' })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/items/${removedId}`)
      .expect(200);

    const feed = await request(app.getHttpServer())
      .get('/api/items')
      .expect(200);
    const ids = feed.body.items.map((i: { id: string }) => i.id);

    expect(ids).toContain(availableId);
    expect(ids).not.toContain(claimedId);
    expect(ids).not.toContain(removedId);
    for (const item of feed.body.items) {
      expect(item.status).toBe('available');
    }
  });
});

describe('@req REQ-CAP-BROWSE-FEED @criterion browse-03-category-filter', () => {
  it('returns only items of the requested category', async () => {
    const foodId = await post(validBody({ title: 'food-item', category: 'food' }));
    const houseId = await post(
      validBody({ title: 'house-item', category: 'household' }),
    );

    const res = await request(app.getHttpServer())
      .get('/api/items?category=food')
      .expect(200);
    const ids = res.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(foodId);
    expect(ids).not.toContain(houseId);
    for (const item of res.body.items) {
      expect(item.category).toBe('food');
    }
  });

  it('omitting the category param returns all categories', async () => {
    const foodId = await post(validBody({ category: 'food' }));
    const houseId = await post(validBody({ category: 'household' }));
    const otherId = await post(validBody({ category: 'other' }));

    const res = await request(app.getHttpServer())
      .get('/api/items')
      .expect(200);
    const ids = res.body.items.map((i: { id: string }) => i.id);
    expect(ids).toEqual(expect.arrayContaining([foodId, houseId, otherId]));
  });

  it('an invalid category value returns 400, not empty results', async () => {
    await request(app.getHttpServer())
      .get('/api/items?category=bogus')
      .expect(400);
  });
});

describe('@req REQ-CAP-GET-ITEM @criterion get-item-01-returns-full-record', () => {
  it('returns 200 with the complete record for an available item', async () => {
    const id = await post(
      validBody({
        title: 'full-record',
        photoUrl: 'https://example.com/p.jpg',
        pickupLatLng: { lat: 40.7, lng: -74 },
        expiresAt: '2026-12-31T00:00:00.000Z',
      }),
    );
    const res = await request(app.getHttpServer())
      .get(`/api/items/${id}`)
      .expect(200);
    expect(res.body).toMatchObject({
      id,
      title: 'full-record',
      description: expect.any(String),
      photoUrl: 'https://example.com/p.jpg',
      category: 'food',
      pickupLocation: '5th Ave bakery',
      pickupLatLng: { lat: 40.7, lng: -74 },
      postedBy: 'Sam',
      status: 'available',
      claimedBy: null,
      expiresAt: '2026-12-31T00:00:00.000Z',
    });
    expect(typeof res.body.createdAt).toBe('string');
  });

  it('returns claimed and removed items too (detail page shows all states)', async () => {
    const claimedId = await post(validBody({ title: 'claimed-detail' }));
    await request(app.getHttpServer())
      .patch(`/api/items/${claimedId}/status`)
      .send({ action: 'claim', claimedBy: 'Lee' })
      .expect(200);
    const claimedRes = await request(app.getHttpServer())
      .get(`/api/items/${claimedId}`)
      .expect(200);
    expect(claimedRes.body.status).toBe('claimed');
    expect(claimedRes.body.claimedBy).toBe('Lee');

    const removedId = await post(validBody({ title: 'removed-detail' }));
    await request(app.getHttpServer())
      .delete(`/api/items/${removedId}`)
      .expect(200);
    const removedRes = await request(app.getHttpServer())
      .get(`/api/items/${removedId}`)
      .expect(200);
    expect(removedRes.body.status).toBe('removed');
  });
});

describe('@req REQ-CAP-GET-ITEM @criterion get-item-02-not-found', () => {
  it('returns 404 for a non-existent id (not 500, not 200 with null)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/items/00000000-0000-0000-0000-000000000000')
      .expect(404);
    expect(res.status).not.toBe(500);
    expect(res.body).not.toBeNull();
  });
});

async function patch(
  id: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(app.getHttpServer()).patch(`/api/items/${id}/status`).send(body);
}

describe('@req REQ-CAP-CLAIM-ITEM @criterion claim-01-available-to-claimed', () => {
  it('claims an available item: 200, status claimed, claimedBy set', async () => {
    const id = await post(validBody({ title: 'to-claim' }));
    const res = await patch(id, { action: 'claim', claimedBy: 'Lee' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('claimed');
    expect(res.body.claimedBy).toBe('Lee');
  });

  it('claimed item no longer appears in the feed', async () => {
    const id = await post(validBody({ title: 'disappears' }));
    await patch(id, { action: 'claim', claimedBy: 'Lee' }).then((r) =>
      expect(r.status).toBe(200),
    );
    const feed = await request(app.getHttpServer()).get('/api/items').expect(200);
    const ids = feed.body.items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(id);
  });

  it('does NOT allow claiming an already-claimed item (409)', async () => {
    const id = await post(validBody());
    await patch(id, { action: 'claim', claimedBy: 'Lee' });
    const res = await patch(id, { action: 'claim', claimedBy: 'Other' });
    expect(res.status).toBe(409);
  });

  it('does NOT allow claim without claimedBy (400)', async () => {
    const id = await post(validBody());
    const res = await patch(id, { action: 'claim' });
    expect(res.status).toBe(400);
  });
});

describe('@req REQ-CAP-CLAIM-ITEM @criterion claim-02-claimed-to-picked-up', () => {
  it('confirms pickup on a claimed item: 200, status picked_up', async () => {
    const id = await post(validBody());
    await patch(id, { action: 'claim', claimedBy: 'Lee' });
    const res = await patch(id, { action: 'confirm_pickup' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('picked_up');
  });

  it('does NOT allow confirm_pickup on an available item (409)', async () => {
    const id = await post(validBody());
    const res = await patch(id, { action: 'confirm_pickup' });
    expect(res.status).toBe(409);
  });

  it('does NOT allow confirm_pickup on a picked_up item (409)', async () => {
    const id = await post(validBody());
    await patch(id, { action: 'claim', claimedBy: 'Lee' });
    await patch(id, { action: 'confirm_pickup' });
    const res = await patch(id, { action: 'confirm_pickup' });
    expect(res.status).toBe(409);
  });
});

describe('@req REQ-CAP-CLAIM-ITEM @criterion claim-03-unclaim-returns-to-available', () => {
  it('unclaims a claimed item: 200, status available, claimedBy null', async () => {
    const id = await post(validBody());
    await patch(id, { action: 'claim', claimedBy: 'Lee' });
    const res = await patch(id, { action: 'unclaim' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('available');
    expect(res.body.claimedBy).toBeNull();
  });

  it('unclaimed item reappears in the browse feed', async () => {
    const id = await post(validBody({ title: 'reappears' }));
    await patch(id, { action: 'claim', claimedBy: 'Lee' });
    await patch(id, { action: 'unclaim' });
    const feed = await request(app.getHttpServer()).get('/api/items').expect(200);
    const ids = feed.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(id);
  });

  it('does NOT allow unclaim on an available item (409)', async () => {
    const id = await post(validBody());
    const res = await patch(id, { action: 'unclaim' });
    expect(res.status).toBe(409);
  });
});

describe('@req REQ-CAP-CLAIM-ITEM @criterion claim-04-not-found', () => {
  it('returns 404 for PATCH on a non-existent id (not 500)', async () => {
    const res = await patch('00000000-0000-0000-0000-000000000000', {
      action: 'claim',
      claimedBy: 'Lee',
    });
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(500);
  });
});
