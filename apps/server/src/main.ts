import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({ origin: true, credentials: true });
  app.useStaticAssets(join(__dirname, '..', '..', 'web', 'dist', 'web', 'browser'));
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  console.log(`QCardWars server listening on http://0.0.0.0:${process.env.PORT ?? 3000}`);
}

void bootstrap();
