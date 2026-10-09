import { SwaggerModule } from '@nestjs/swagger';
import { createApp, GLOBAL_PREFIX } from './app.setup';
import { buildOpenApiDocument } from './openapi';

async function bootstrap() {
  const app = await createApp();

  // Swagger UI is for local development only; production serves no spec.
  if (process.env.NODE_ENV !== 'production') {
    SwaggerModule.setup(`${GLOBAL_PREFIX}/docs`, app, () =>
      buildOpenApiDocument(app),
    );
  }

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
