import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { I18nValidationPipe } from 'nestjs-i18n';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { runPendingMigrations } from './database/migrations/runner';
import { run as runSeed } from './database/seeders/seed';

async function bootstrap(): Promise<void> {
  await runPendingMigrations();

  if (process.env.RUN_SEED === 'true') {
    await runSeed();
  }

  const app = await NestFactory.create(AppModule);
  const httpLogger = new Logger('HTTP');

  app.use((req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    httpLogger.log(`METHOD: ${req.method}  PATH: ${req.originalUrl}`);
    next();
  });

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3001'];

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
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
