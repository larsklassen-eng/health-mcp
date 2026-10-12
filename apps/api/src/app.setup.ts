import type { NestExpressApplication } from "@nestjs/platform-express";

import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { validationPipe } from "./common/validation.js";
import type { Env } from "./config/env.js";

/** App-wide wiring shared by `main.ts` and the e2e tests. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  // Patient import files carry many records; Express's default JSON limit is 100 KB.
  app.useBodyParser("json", { limit: "5mb" });
  app.enableCors({ origin: env.WEB_ORIGIN });
  app.useGlobalPipes(validationPipe);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}
