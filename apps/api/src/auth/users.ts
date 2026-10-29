import { type HealthDb, users, type UserRow } from "@health-mcp/db";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@health-mcp/shared";
import { asc, eq } from "drizzle-orm";

import { hashPassword } from "./password.js";

/*
 * The people who may sign in, shared by AuthService and the users command
 * (`src/cli/users.ts`). Emails are stored lowercase.
 */

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Why a new email or password is refused, or undefined when it is fine. */
export function emailProblem(email: string): string | undefined {
  return EMAIL.test(normalizeEmail(email)) ? undefined : "That is not an email address.";
}

export function passwordProblem(password: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  return undefined;
}

export const findUserByEmail = (db: HealthDb, email: string): UserRow | undefined =>
  db
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .get();

export const findUserById = (db: HealthDb, id: string): UserRow | undefined =>
  db.select().from(users).where(eq(users.id, id)).get();

export const listUsers = (db: HealthDb): UserRow[] =>
  db.select().from(users).orderBy(asc(users.email)).all();

export async function createUser(
  db: HealthDb,
  input: { email: string; password: string; name?: string | undefined },
): Promise<UserRow> {
  const problem = emailProblem(input.email) ?? passwordProblem(input.password);
  if (problem) throw new Error(problem);
  if (findUserByEmail(db, input.email))
    throw new Error(`${normalizeEmail(input.email)} already exists.`);
  return db
    .insert(users)
    .values({
      email: normalizeEmail(input.email),
      name: input.name?.trim() || null,
      passwordHash: await hashPassword(input.password),
    })
    .returning()
    .get();
}

/** Sets a new password, ending the user's sessions. Returns false for unknown emails. */
export async function setPassword(db: HealthDb, email: string, password: string) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const updated = db
    .update(users)
    .set({
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date().toISOString(),
    })
    .where(eq(users.email, normalizeEmail(email)))
    .returning({ id: users.id })
    .all();
  return updated.length > 0;
}

/** Deletes a user, which ends their sessions. Returns false for unknown emails. */
export function removeUser(db: HealthDb, email: string): boolean {
  return (
    db
      .delete(users)
      .where(eq(users.email, normalizeEmail(email)))
      .returning({ id: users.id })
      .all().length > 0
  );
}
