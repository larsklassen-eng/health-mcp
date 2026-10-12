import type { INestApplication } from "@nestjs/common";

import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { validationPipe } from "./common/validation.js";
import type { Env } from "./config/env.js";

/** App-wide wiring shared by `main.ts` and the e2e tests. */
export function configureApp(app: INestApplication, env: Env): void {
  app.enableCors({ origin: env.WEB_ORIGIN });
  app.useGlobalPipes(validationPipe);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}
