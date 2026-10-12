import { createDb, type DbConnection, type HealthDb, resolveDatabasePath } from "@health-mcp/db";
import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";

import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";

/**
 * Owns the SQLite connection for the api process. Inject it and use `.db` for
 * Drizzle queries. Tables are created by `yarn db:migrate`, not on startup.
 */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly connection: DbConnection;

  constructor(@Inject(ENV) env: Env) {
    this.connection = createDb({ path: resolveDatabasePath(env) });
    this.logger.log(`Opened SQLite database at ${this.connection.path}`);
  }

  get db(): HealthDb {
    return this.connection.db;
  }

  /** Throws if the database cannot be queried. */
  ping(): void {
    this.connection.db.$client.prepare("select 1").get();
  }

  onApplicationShutdown(): void {
    this.connection.close();
  }
}
