import "reflect-metadata";

import { migrateDb } from "@health-mcp/db";
import type { Type } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";

import { configureApp } from "../src/app.setup.js";
import { ENV } from "../src/config/config.module.js";
import type { Env } from "../src/config/env.js";
import { DatabaseService } from "../src/database/database.service.js";

export interface TestApp {
  app: NestExpressApplication;
  /** Base URL of the running app, e.g. `http://127.0.0.1:54321`. */
  url: string;
  /** Sends a JSON request and returns the status and parsed body (`undefined` for empty bodies). */
  request: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

export interface ProviderOverride {
  /** Injection token to replace, e.g. `LlmClient`. */
  provide: unknown;
  useValue: unknown;
}

/**
 * Boots `module` with the same wiring as `main.ts`, on a random port. When the
 * module includes the database, its fresh in-memory SQLite gets all migrations.
 * `overrides` replace providers, e.g. the LLM client with a `FakeLlmClient`.
 */
export async function startTestApp(module: Type, overrides: ProviderOverride[] = []): Promise<TestApp> {
  let builder = Test.createTestingModule({ imports: [module] });
  for (const { provide, useValue } of overrides) builder = builder.overrideProvider(provide).useValue(useValue);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, app.get<Env>(ENV));

  const database = findDatabase(app);
  if (database) migrateDb(database.db);

  await app.listen(0, "127.0.0.1");
  const url = (await app.getUrl()).replace("[::1]", "127.0.0.1");

  const request: TestApp["request"] = async (method, path, body) => {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  };

  return { app, url, request, close: () => app.close() };
}

function findDatabase(app: NestExpressApplication): DatabaseService | undefined {
  try {
    return app.get(DatabaseService, { strict: false });
  } catch {
    return undefined; // module without DatabaseModule
  }
}
