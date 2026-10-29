import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { GoogleOAuth, HttpGoogleOAuth } from "./google-oauth.js";

/** Google sign-in, and the guard that requires a session on every other route. */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: GoogleOAuth,
      inject: [ENV],
      useFactory: (env: Env) =>
        new HttpGoogleOAuth(env.GOOGLE_CLIENT_ID ?? "", env.GOOGLE_CLIENT_SECRET ?? ""),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
