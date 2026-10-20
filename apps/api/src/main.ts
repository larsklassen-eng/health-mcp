import "./load-env.js";
import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module.js";
import { configureApp } from "./app.setup.js";
import { QuietStartupLogger } from "./common/quiet-startup-logger.js";
import { ENV } from "./config/config.module.js";
import type { Env } from "./config/env.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new QuietStartupLogger(),
  });
  const env = app.get<Env>(ENV);
  configureApp(app, env);
  await app.listen(env.PORT);
  new Logger("Bootstrap").log(`api listening on http://localhost:${env.PORT}`);
}

await bootstrap();
