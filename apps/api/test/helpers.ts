import "reflect-metadata";

import type { INestApplication, Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { configureApp } from "../src/app.setup.js";
import { ENV } from "../src/config/config.module.js";
import type { Env } from "../src/config/env.js";

export interface TestApp {
  app: INestApplication;
  /** Base URL of the running app, e.g. `http://127.0.0.1:54321`. */
  url: string;
  close: () => Promise<void>;
}

/** Boots `module` with the same wiring as `main.ts`, on a random port. */
export async function startTestApp(module: Type): Promise<TestApp> {
  const app = await NestFactory.create(module, { logger: false });
  configureApp(app, app.get<Env>(ENV));
  await app.listen(0, "127.0.0.1");
  const url = (await app.getUrl()).replace("[::1]", "127.0.0.1");
  return { app, url, close: () => app.close() };
}
