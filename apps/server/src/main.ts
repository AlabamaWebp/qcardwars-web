import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { join } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({ origin: true, credentials: true });
  // The web client speaks the Socket.IO protocol; without this the default `ws`
  // adapter would reject it, breaking all multiplayer.
  app.useWebSocketAdapter(new IoAdapter(app));
  // nest compiles to <workspace>/apps/server/dist/src/main.js, so walk up three
  // levels to the workspace root and into the Angular browser bundle.
  app.useStaticAssets(join(__dirname, '..', '..', '..', 'web', 'dist', 'web', 'browser'));
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  console.log(`QCardWars server listening on http://0.0.0.0:${process.env.PORT ?? 3000}`);
}

void bootstrap();
