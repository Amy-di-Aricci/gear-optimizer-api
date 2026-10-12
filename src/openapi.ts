import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('gear-optimizer-api')
    .setDescription('Backend API for Where is my loot!?')
    .setVersion('0')
    .build();
  return SwaggerModule.createDocument(app, config);
}
