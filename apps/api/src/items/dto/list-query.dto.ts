// REQ-CAP-BROWSE-FEED :: query-string validation for GET /api/items.
//
// An invalid `category` value must yield 400 (browse-03 negative
// case), not silently-empty results. Omitting it returns all
// categories.

import { z } from 'zod';

export const listQuerySchema = z.object({
  category: z.enum(['food', 'household', 'other']).optional(),
});

export type ListQueryDto = z.infer<typeof listQuerySchema>;
