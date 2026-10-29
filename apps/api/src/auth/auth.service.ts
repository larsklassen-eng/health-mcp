import type { AuthUser, LoginInput, LoginResponse } from "@health-mcp/shared";
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { DatabaseService } from "../database/database.service.js";
import { LoginThrottle } from "./login-throttle.js";
import { UNKNOWN_USER_HASH, verifyPassword } from "./password.js";
import { TokenSealer } from "./sealed-token.js";
import { findUserByEmail, findUserById, normalizeEmail } from "./users.js";

const toAuthUser = (user: { email: string; name: string | null }): AuthUser => ({
  email: user.email,
  ...(user.name && { name: user.name }),
});

/**
 * Email and password sign-in, and sessions. A session is a sealed token
 * (user id and time of issue) that apps/web keeps in a cookie; nothing is
 * stored. Each request looks the user up again, so deleting a user or
 * changing their password ends their sessions at once.
 */
@Injectable()
export class AuthService {
  private readonly sealer?: TokenSealer;
  private readonly throttle = new LoginThrottle();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly database: DatabaseService,
  ) {
    if (env.SESSION_SECRET) this.sealer = new TokenSealer(env.SESSION_SECRET);
  }

  get enabled(): boolean {
    return this.env.AUTH_MODE === "password";
  }

  async login({ email, password }: LoginInput): Promise<LoginResponse> {
    if (!this.enabled || !this.sealer) throw new UnauthorizedException("Sign-in is off.");
    const key = normalizeEmail(email);
    const wait = this.throttle.retryAfter(key);
    if (wait > 0)
      throw new HttpException(
        `Too many failed sign-ins. Try again in ${Math.ceil(wait / 60_000)} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const user = findUserByEmail(this.database.db, key);
    // Unknown emails are checked against a dummy hash, so they take as long as a wrong password.
    const valid = await verifyPassword(password, user?.passwordHash ?? UNKNOWN_USER_HASH);
    if (!user || !valid) {
      this.throttle.fail(key);
      throw new UnauthorizedException("The email or password is incorrect.");
    }
    this.throttle.succeed(key);

    const ttlSeconds = this.env.SESSION_TTL_HOURS * 3600;
    const issuedAt = Date.now();
    return {
      session: this.sealer.seal("session", { sub: user.id, iat: issuedAt }, ttlSeconds, issuedAt),
      user: toAuthUser(user),
      expiresAt: new Date(issuedAt + ttlSeconds * 1000).toISOString(),
    };
  }

  /** The session's user, or undefined if the token is invalid or expired, or the user is gone. */
  verifySession(token: string): AuthUser | undefined {
    const payload = this.sealer?.open("session", token);
    if (!payload || typeof payload.sub !== "string" || typeof payload.iat !== "number")
      return undefined;
    const user = findUserById(this.database.db, payload.sub);
    // A password change ends the sessions issued before it.
    if (!user || Date.parse(user.passwordChangedAt) > payload.iat) return undefined;
    return toAuthUser(user);
  }
}
