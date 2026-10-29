import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from "node:crypto";

/*
 * Password hashing with scrypt (memory-hard, built into Node). A hash keeps its
 * parameters and salt: `scrypt$<N>$<r>$<p>$<salt>$<hash>` (base64url), so the
 * cost can be raised later without breaking existing passwords.
 */

const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer, { N, r, p }: { N: number; r: number; p: number }) {
  const options: ScryptOptions = { N, r, p, maxmem: 128 * N * r * 2 };
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  const { N, r, p } = PARAMS;
  return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [scheme, N, r, p, salt, expected] = hash.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  if (!Object.values(params).every(Number.isInteger)) return false;
  const key = await derive(password, Buffer.from(salt, "base64url"), params);
  const wanted = Buffer.from(expected, "base64url");
  return key.length === wanted.length && timingSafeEqual(key, wanted);
}

/**
 * Checked against when the email is unknown, so a wrong email takes as long
 * as a wrong password and response times do not reveal who has an account.
 */
export const UNKNOWN_USER_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
