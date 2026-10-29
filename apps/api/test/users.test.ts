import { createDb, migrateDb } from "@health-mcp/db";
import { beforeEach, describe, expect, it } from "vitest";

import { verifyPassword } from "../src/auth/password.js";
import {
  createUser,
  findUserByEmail,
  listUsers,
  removeUser,
  setPassword,
} from "../src/auth/users.js";

let db: ReturnType<typeof createDb>["db"];
beforeEach(() => {
  db = createDb({ path: ":memory:" }).db;
  migrateDb(db);
});

describe("users", () => {
  it("creates a user with a lowercase email and a hashed password", async () => {
    const user = await createUser(db, {
      email: " Ana@Example.com ",
      password: "long enough password",
      name: " Ana ",
    });

    expect(user).toMatchObject({ email: "ana@example.com", name: "Ana" });
    expect(user.passwordHash).not.toContain("long enough");
    expect(await verifyPassword("long enough password", user.passwordHash)).toBe(true);
    expect(findUserByEmail(db, "ANA@example.com")?.id).toBe(user.id);
  });

  it.each([
    [{ email: "not-an-email", password: "long enough password" }, "not an email"],
    [{ email: "ana@example.com", password: "short" }, "at least 12"],
    [{ email: "ana@example.com", password: "x".repeat(201) }, "at most 200"],
  ])("refuses %j", async (input, message) => {
    await expect(createUser(db, input)).rejects.toThrow(message);
  });

  it("refuses a second user with the same email in another case", async () => {
    await createUser(db, { email: "ana@example.com", password: "long enough password" });

    await expect(
      createUser(db, { email: "ANA@example.com", password: "another password!" }),
    ).rejects.toThrow("ana@example.com already exists.");
  });

  it("changes a password and records when", async () => {
    const before = await createUser(db, {
      email: "ana@example.com",
      password: "long enough password",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(await setPassword(db, "ANA@example.com", "a brand new password")).toBe(true);
    expect(await setPassword(db, "nobody@example.com", "a brand new password")).toBe(false);
    await expect(setPassword(db, "ana@example.com", "short")).rejects.toThrow("at least 12");

    const after = findUserByEmail(db, "ana@example.com")!;
    expect(await verifyPassword("a brand new password", after.passwordHash)).toBe(true);
    expect(Date.parse(after.passwordChangedAt)).toBeGreaterThan(
      Date.parse(before.passwordChangedAt),
    );
  });

  it("lists users by email and removes them", async () => {
    await createUser(db, { email: "ben@example.com", password: "long enough password" });
    await createUser(db, { email: "ana@example.com", password: "long enough password" });

    expect(listUsers(db).map((u) => u.email)).toEqual(["ana@example.com", "ben@example.com"]);
    expect(removeUser(db, "Ben@example.com")).toBe(true);
    expect(removeUser(db, "ben@example.com")).toBe(false);
    expect(listUsers(db).map((u) => u.email)).toEqual(["ana@example.com"]);
  });
});
