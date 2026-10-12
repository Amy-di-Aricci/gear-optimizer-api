import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

export const GLOBAL_PREFIX = 'api';

// Shared by main.ts, the OpenAPI export and the e2e tests, so they all run
// the same app configuration.
export async function createApp(
  options: { logger?: false | ('error' | 'warn' | 'log')[] } = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    ...options,
  });
  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.use(helmet());
  // Global body limit (docs/security.md, A06). Import uploads get their own.
  app.useBodyParser('json', { limit: '100kb' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
  return app;
}
