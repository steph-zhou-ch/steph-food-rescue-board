// REQ-CAP-CLAIM-ITEM :: request validation for PATCH /api/items/:id/status.
//
// `claimedBy` is required when action='claim' (claim-01 negative case:
// claim without claimedBy → 400) and ignored otherwise.

import { z } from 'zod';

export const updateStatusSchema = z
  .object({
    action: z.enum(['claim', 'unclaim', 'confirm_pickup'], {
      required_error: 'action is required',
      invalid_type_error:
        'action must be one of claim, unclaim, confirm_pickup',
    }),
    claimedBy: z
      .string()
      .min(1, 'claimedBy must be 1-50 characters')
      .max(50, 'claimedBy must be 1-50 characters')
      .optional(),
  })
  .refine((data) => data.action !== 'claim' || data.claimedBy !== undefined, {
    message: 'claimedBy is required when action is claim',
    path: ['claimedBy'],
  });

export type UpdateStatusDto = z.infer<typeof updateStatusSchema>;
