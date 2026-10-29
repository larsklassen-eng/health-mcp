import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Tokens the api hands out and later reads back (sessions): JSON sealed with
 * AES-256-GCM, so they can be neither read nor changed without the key. Each
 * token names its purpose, so a token made for something else can never be
 * used as a session. Format: `v1.<iv>.<ciphertext>.<tag>` (base64url).
 */
export type TokenPurpose = "session";

const VERSION = "v1";

export class TokenSealer {
  private readonly key: Buffer;

  constructor(secret: string) {
    // A key for this use only, derived from SESSION_SECRET.
    this.key = Buffer.from(hkdfSync("sha256", secret, "", "health-mcp tokens v1", 32));
  }

  seal(purpose: TokenPurpose, payload: object, ttlSeconds: number, now = Date.now()): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(purpose));
    const body = JSON.stringify({ ...payload, exp: now + ttlSeconds * 1000 });
    const ciphertext = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
    return [VERSION, iv, ciphertext, cipher.getAuthTag()]
      .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
      .join(".");
  }

  /**
   * The payload, or undefined if the token is malformed, tampered with, for
   * another purpose or expired.
   */
  open(
    purpose: TokenPurpose,
    token: string,
    now = Date.now(),
  ): Record<string, unknown> | undefined {
    const [version, iv, ciphertext, tag, ...rest] = token.split(".");
    if (version !== VERSION || !iv || !ciphertext || !tag || rest.length > 0) return undefined;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      const body = Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
      const payload = JSON.parse(body) as Record<string, unknown>;
      return typeof payload.exp === "number" && payload.exp > now ? payload : undefined;
    } catch {
      return undefined;
    }
  }
}
