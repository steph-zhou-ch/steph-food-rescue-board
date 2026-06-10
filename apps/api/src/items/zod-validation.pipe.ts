// A reusable zod validation pipe. On parse failure it throws
// BadRequestException (HTTP 400) with a message naming the offending
// field(s) — satisfying the "names the missing field" predicates and
// guaranteeing validation failures are 400, never 500.

import {
  BadRequestException,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import type { ZodSchema } from 'zod';

export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      const message = result.error.issues
        .map((issue) => {
          const path = issue.path.join('.');
          return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
      throw new BadRequestException(message);
    }
    return result.data;
  }
}
