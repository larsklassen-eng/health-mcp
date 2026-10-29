import { createHash, randomBytes } from "node:crypto";

import type {
  AuthCallbackInput,
  AuthCallbackResponse,
  AuthStartResponse,
  AuthUser,
} from "@health-mcp/shared";
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";

import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { GoogleOAuth } from "./google-oauth.js";
import { TokenSealer } from "./sealed-token.js";

/** Path of apps/web's page that Google sends the browser back to. */
export const WEB_CALLBACK_PATH = "/auth/callback";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
/** How long a started sign-in may take. */
const LOGIN_TTL_SECONDS = 10 * 60;

const randomToken = (bytes: number) => randomBytes(bytes).toString("base64url");

/**
 * Google sign-in (OpenID Connect, authorization code with PKCE) and sessions.
 * Nothing is stored: the sign-in state and the session are sealed tokens that
 * apps/web keeps in cookies, and the allowlist is checked on every request.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly sealer?: TokenSealer;
  private readonly allowed: ReadonlySet<string>;
  private readonly redirectUri: string;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly google: GoogleOAuth,
  ) {
    if (env.SESSION_SECRET) this.sealer = new TokenSealer(env.SESSION_SECRET);
    this.allowed = new Set(env.AUTH_ALLOWED_EMAILS);
    this.redirectUri = new URL(WEB_CALLBACK_PATH, env.WEB_ORIGIN).toString();
  }

  get enabled(): boolean {
    return this.env.AUTH_MODE === "google";
  }

  start(): AuthStartResponse {
    const sealer = this.requireSealer();
    const state = randomToken(16);
    const nonce = randomToken(16);
    const codeVerifier = randomToken(32);
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    return {
      url: this.google.authorizationUrl({
        redirectUri: this.redirectUri,
        state,
        nonce,
        codeChallenge,
      }),
      loginState: sealer.seal("login", { state, nonce, codeVerifier }, LOGIN_TTL_SECONDS),
    };
  }

  async finish({ code, state, loginState }: AuthCallbackInput): Promise<AuthCallbackResponse> {
    const sealer = this.requireSealer();
    const kept = sealer.open("login", loginState);
    if (!kept || kept.state !== state || typeof kept.codeVerifier !== "string")
      throw new UnauthorizedException("The sign-in expired or was not started here. Try again.");

    let claims;
    try {
      claims = await this.google.exchangeCode({
        code,
        codeVerifier: kept.codeVerifier,
        redirectUri: this.redirectUri,
      });
    } catch (error) {
      this.logger.warn(`Google sign-in failed: ${String(error)}`);
      throw new UnauthorizedException("Google sign-in failed. Try again.");
    }

    const valid =
      GOOGLE_ISSUERS.includes(claims.iss) &&
      claims.aud === this.env.GOOGLE_CLIENT_ID &&
      claims.exp * 1000 > Date.now() &&
      claims.nonce === kept.nonce &&
      claims.email_verified === true &&
      Boolean(claims.email);
    if (!valid) throw new UnauthorizedException("Google sign-in could not be verified. Try again.");

    const email = claims.email!.toLowerCase();
    if (!this.allowed.has(email)) {
      this.logger.warn(`Sign-in refused for an address not on the allowlist`);
      throw new ForbiddenException(`${email} may not use this deployment.`);
    }

    const user: AuthUser = { email, ...(claims.name && { name: claims.name }) };
    const ttlSeconds = this.env.SESSION_TTL_HOURS * 3600;
    return {
      session: sealer.seal("session", user, ttlSeconds),
      user,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  /** The session's user, or undefined if the token is invalid, expired or no longer allowed. */
  verifySession(token: string): AuthUser | undefined {
    const payload = this.sealer?.open("session", token);
    if (!payload || typeof payload.email !== "string" || !this.allowed.has(payload.email))
      return undefined;
    return {
      email: payload.email,
      ...(typeof payload.name === "string" && { name: payload.name }),
    };
  }

  private requireSealer(): TokenSealer {
    if (!this.enabled || !this.sealer) throw new NotFoundException("Sign-in is off.");
    return this.sealer;
  }
}
