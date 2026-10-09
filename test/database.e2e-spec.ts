import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

// Needs a real Postgres (DATABASE_URL). CI provides one; locally, point
// DATABASE_URL at your Neon dev branch or a local Postgres.
describe.skipIf(!process.env.DATABASE_URL)('database connection', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs a query through the Prisma adapter', async () => {
    const prisma = app.get(PrismaService);
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
    expect(rows).toEqual([{ ok: 1 }]);
  });
});
