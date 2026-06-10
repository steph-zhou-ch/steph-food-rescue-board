import 'reflect-metadata';

import { pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const PORT = Number(process.env['PORT'] || '3001');

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.enableCors({ origin: true });
  await app.listen(PORT);
  console.log(`API running on http://localhost:${PORT}`);
}

const isEntrypoint =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  void bootstrap();
}
