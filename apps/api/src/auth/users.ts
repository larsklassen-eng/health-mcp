import { type HealthDb, users, type UserRow } from "@health-mcp/db";
import { NAME_MAX_LENGTH } from "@health-mcp/shared";
import { checkPassword, type PasswordOwner } from "@health-mcp/shared/password";
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

export function nameProblem(firstName: string, lastName: string): string | undefined {
  if (!firstName.trim() || !lastName.trim()) return "Enter a first and a last name.";
  if (firstName.trim().length > NAME_MAX_LENGTH || lastName.trim().length > NAME_MAX_LENGTH)
    return `Use at most ${NAME_MAX_LENGTH} characters for each name.`;
  return undefined;
}

/** The password rules (12+ characters, hard to guess, without the owner's names or email). */
export function passwordProblem(password: string, owner: PasswordOwner): string | undefined {
  return checkPassword(password, owner).problem;
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
  input: { email: string; password: string; firstName: string; lastName: string },
): Promise<UserRow> {
  const problem =
    emailProblem(input.email) ??
    nameProblem(input.firstName, input.lastName) ??
    passwordProblem(input.password, input);
  if (problem) throw new Error(problem);
  if (findUserByEmail(db, input.email))
    throw new Error(`${normalizeEmail(input.email)} already exists.`);
  return db
    .insert(users)
    .values({
      email: normalizeEmail(input.email),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      passwordHash: await hashPassword(input.password),
    })
    .returning()
    .get();
}

/** Sets a new password, ending the user's sessions. Returns false for unknown emails. */
export async function setPassword(db: HealthDb, email: string, password: string) {
  const user = findUserByEmail(db, email);
  if (!user) return false;
  const problem = passwordProblem(password, user);
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
