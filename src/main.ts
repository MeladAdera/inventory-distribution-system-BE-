import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { I18nValidationPipe } from 'nestjs-i18n';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { runPendingMigrations } from './database/migrations/runner';
import { run as runSeed } from './database/seeders/seed';
import { assertDemoDatabase, resetDemoData, scheduleDailyDemoReset } from './database/seeders/demo-seed';

async function bootstrap(): Promise<void> {
  const demoMode = process.env.DEMO_MODE === 'true';

  // Before migrations, so a service pointed at the wrong database stops here.
  if (demoMode) {
    await assertDemoDatabase();
  }

  await runPendingMigrations();

  if (demoMode) {
    await resetDemoData();
    scheduleDailyDemoReset();
  } else if (process.env.RUN_SEED === 'true') {
    await runSeed();
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const httpLogger = new Logger('HTTP');

  // Render sits behind more than one proxy, so `true` (the left-most forwarded
  // address) is what gives each visitor their own rate limit. Clients can spoof
  // that header, which is acceptable here: the demo's passwords are public.
  if (demoMode) {
    app.set('trust proxy', true);
  }

  app.use((req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    httpLogger.log(`METHOD: ${req.method}  PATH: ${req.originalUrl}`);
    next();
  });

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3001'];

  app.enableCors({
    origin: allowedOrigins,
    // PUT is here because the shift routes replace a whole collection at once —
    // the seven-day trading week, and a slot's entire rota. Every module before
    // them patched single fields, so the omission was invisible until the first
    // PUT shipped: the browser blocks the request at preflight, and the caller
    // sees a failure with no response body to explain it.
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language'],
    credentials: true,
  });

  app.useGlobalPipes(
    new I18nValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new TransformInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Inventory Distribution System')
    .setDescription('REST API for inventory and distribution management')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger docs:             http://localhost:${port}/api`);
}

void bootstrap();
