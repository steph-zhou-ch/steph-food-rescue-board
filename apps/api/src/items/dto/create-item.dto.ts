// REQ-CAP-POST-ITEM :: request validation schema for POST /api/items.
//
// Zod enforces required-ness (post-02) and length limits (post-03)
// pre-storage, so invalid input yields 400 (never 500, never a
// silently-truncated record).

import { z } from 'zod';

export const latLngSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

export const createItemSchema = z.object({
  title: z
    .string({ required_error: 'title is required' })
    .min(1, 'title is required')
    .max(100, 'title must be at most 100 characters'),
  description: z
    .string({ required_error: 'description is required' })
    .min(1, 'description is required')
    .max(500, 'description must be at most 500 characters'),
  photoUrl: z.string().url('photoUrl must be a valid URL').optional(),
  category: z.enum(['food', 'household', 'other'], {
    required_error: 'category is required',
    invalid_type_error: 'category must be one of food, household, other',
  }),
  pickupLocation: z
    .string({ required_error: 'pickupLocation is required' })
    .min(1, 'pickupLocation is required')
    .max(200, 'pickupLocation must be at most 200 characters'),
  pickupLatLng: latLngSchema.optional(),
  postedBy: z
    .string({ required_error: 'postedBy is required' })
    .min(1, 'postedBy is required')
    .max(50, 'postedBy must be at most 50 characters'),
  expiresAt: z
    .string()
    .datetime({ message: 'expiresAt must be an ISO-8601 datetime' })
    .optional(),
});

export type CreateItemDto = z.infer<typeof createItemSchema>;
