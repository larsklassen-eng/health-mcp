import type { UserRow } from "@health-mcp/db";
import type { AuthUser, LoginInput, LoginResponse, RegisterInput } from "@health-mcp/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

import { isUniqueViolation } from "../common/sqlite-errors.js";

import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { DatabaseService } from "../database/database.service.js";
import { LoginThrottle } from "./login-throttle.js";
import { UNKNOWN_USER_HASH, verifyPassword } from "./password.js";
import { TokenSealer } from "./sealed-token.js";
import { SignupLimit } from "./signup-limit.js";
import {
  createUser,
  emailProblem,
  findUserByEmail,
  findUserById,
  nameProblem,
  normalizeEmail,
  passwordProblem,
} from "./users.js";

/** A signed-in user, with the id the api scopes their patients by. */
export type SessionUser = AuthUser & { id: string };

type UserFields = Pick<
  UserRow,
  "email" | "firstName" | "lastName" | "role" | "patientId" | "mustChangePassword"
>;

export const toAuthUser = (user: UserFields | SessionUser): AuthUser => ({
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  role: user.role,
  ...(user.patientId && { patientId: user.patientId }),
  mustChangePassword: user.mustChangePassword,
});

/**
 * Email and password sign-in, sign-up, and sessions. A session is a sealed token
 * (user id and time of issue) that apps/web keeps in a cookie; nothing is
 * stored. Each request looks the user up again, so deleting a user or
 * changing their password ends their sessions at once.
 */
@Injectable()
export class AuthService {
  private readonly sealer?: TokenSealer;
  private readonly throttle = new LoginThrottle();
  private readonly signups: SignupLimit;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly database: DatabaseService,
  ) {
    if (env.SESSION_SECRET) this.sealer = new TokenSealer(env.SESSION_SECRET);
    this.signups = new SignupLimit(env.SIGNUPS_PER_HOUR);
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
    return this.startSession(this.sealer, user);
  }

  /**
   * Creates a doctor's account and signs them in. There is no email check, so
   * an email that is taken is said to be taken. At most SIGNUPS_PER_HOUR
   * accounts are created per hour.
   */
  async register(input: RegisterInput): Promise<LoginResponse> {
    if (!this.enabled || !this.sealer) throw new UnauthorizedException("Sign-in is off.");
    if (this.env.SIGNUPS_PER_HOUR === 0)
      throw new ForbiddenException("Sign-up is closed. Ask an administrator for an account.");

    const problem =
      nameProblem(input.firstName, input.lastName) ??
      emailProblem(input.email) ??
      passwordProblem(input.password, input);
    if (problem) throw new BadRequestException(problem);

    const wait = this.signups.retryAfter();
    if (wait > 0)
      throw new HttpException(
        `Too many new accounts right now. Try again in ${Math.ceil(wait / 60_000)} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const taken = new ConflictException("An account with this email exists. Sign in instead.");
    if (findUserByEmail(this.database.db, input.email)) throw taken;

    let user: UserRow;
    try {
      user = await createUser(this.database.db, input);
    } catch (error) {
      // Another sign-up with the same email got there first.
      const raced = isUniqueViolation(error) || findUserByEmail(this.database.db, input.email);
      throw raced ? taken : error;
    }
    this.signups.record();
    return this.startSession(this.sealer, user);
  }

  private startSession(sealer: TokenSealer, user: UserRow): LoginResponse {
    const ttlSeconds = this.env.SESSION_TTL_HOURS * 3600;
    const issuedAt = Date.now();
    return {
      session: sealer.seal("session", { sub: user.id, iat: issuedAt }, ttlSeconds, issuedAt),
      user: toAuthUser(user),
      expiresAt: new Date(issuedAt + ttlSeconds * 1000).toISOString(),
    };
  }

  /** The session's user, or undefined if the token is invalid or expired, or the user is gone. */
  verifySession(token: string): SessionUser | undefined {
    const payload = this.sealer?.open("session", token);
    if (!payload || typeof payload.sub !== "string" || typeof payload.iat !== "number")
      return undefined;
    const user = findUserById(this.database.db, payload.sub);
    // A password change ends the sessions issued before it.
    if (!user || Date.parse(user.passwordChangedAt) > payload.iat) return undefined;
    return { id: user.id, ...toAuthUser(user) };
  }
}
