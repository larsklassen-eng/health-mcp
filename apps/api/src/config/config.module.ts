import { Global, Module } from "@nestjs/common";

import { loadEnv } from "./env.js";

/** Injection token for the validated {@link Env}. Use `@Inject(ENV) env: Env`. */
export const ENV = Symbol("ENV");

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
