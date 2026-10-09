// Boots the app without listening and writes openapi.json, which is committed
// and checked in CI. Run with `npm run openapi:export`.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../src/app.setup';
import { buildOpenApiDocument } from '../src/openapi';

async function exportOpenApi() {
  const app = await createApp({ logger: ['error', 'warn'] });
  await app.init();

  const document = buildOpenApiDocument(app);
  const target = resolve(__dirname, '..', 'openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
}
void exportOpenApi();
