import { createDb, migrateDb, patients, users } from "@health-mcp/db";
import { beforeEach, describe, expect, it } from "vitest";

import { verifyPassword } from "../src/auth/password.js";
import {
  assignUnownedPatients,
  countPatientsByOwner,
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

const NAMES = { firstName: "Ana", lastName: "Example" };

describe("users", () => {
  it("creates a user with a lowercase email and a hashed password", async () => {
    const user = await createUser(db, {
      email: " Ana@Example.com ",
      password: "long enough password",
      firstName: " Ana ",
      lastName: " Example ",
    });

    expect(user).toMatchObject({ email: "ana@example.com", firstName: "Ana", lastName: "Example" });
    expect(user.passwordHash).not.toContain("long enough");
    expect(await verifyPassword("long enough password", user.passwordHash)).toBe(true);
    expect(findUserByEmail(db, "ANA@example.com")?.id).toBe(user.id);
  });

  it.each([
    [{ email: "not-an-email", password: "long enough password" }, "not an email"],
    [{ email: "ana@example.com", password: "short" }, "at least 12"],
    [{ email: "ana@example.com", password: "password1234" }, "commonly used password"],
    [{ email: "ana@example.com", password: "Example rocks 2026" }, "name and email"],
    [{ email: "ana@example.com", password: "x".repeat(201) }, "at most 200"],
    [{ email: "ana@example.com", password: "long enough password", lastName: " " }, "last name"],
    [
      { email: "ana@example.com", password: "long enough password", firstName: "x".repeat(101) },
      "at most 100",
    ],
  ])("refuses %j", async (input, message) => {
    await expect(createUser(db, { ...NAMES, ...input })).rejects.toThrow(message);
  });

  it("refuses a second user with the same email in another case", async () => {
    await createUser(db, { ...NAMES, email: "ana@example.com", password: "long enough password" });

    await expect(
      createUser(db, { ...NAMES, email: "ANA@example.com", password: "another password!" }),
    ).rejects.toThrow("ana@example.com already exists.");
  });

  it("changes a password and records when", async () => {
    const before = await createUser(db, {
      ...NAMES,
      email: "ana@example.com",
      password: "long enough password",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(await setPassword(db, "ANA@example.com", "a brand new password")).toBe(true);
    expect(await setPassword(db, "nobody@example.com", "a brand new password")).toBe(false);
    await expect(setPassword(db, "ana@example.com", "short")).rejects.toThrow("at least 12");
    await expect(setPassword(db, "ana@example.com", "ana@example.com 2026")).rejects.toThrow(
      "name and email",
    );

    const after = findUserByEmail(db, "ana@example.com")!;
    expect(await verifyPassword("a brand new password", after.passwordHash)).toBe(true);
    expect(Date.parse(after.passwordChangedAt)).toBeGreaterThan(
      Date.parse(before.passwordChangedAt),
    );
  });

  it("lists users by email and removes them", async () => {
    await createUser(db, { ...NAMES, email: "ben@example.com", password: "long enough password" });
    await createUser(db, { ...NAMES, email: "ana@example.com", password: "long enough password" });

    expect(listUsers(db).map((u) => u.email)).toEqual(["ana@example.com", "ben@example.com"]);
    expect(removeUser(db, "Ben@example.com")).toBe(true);
    expect(removeUser(db, "ben@example.com")).toBe(false);
    expect(listUsers(db).map((u) => u.email)).toEqual(["ana@example.com"]);
  });
});

describe("patients without an owner", () => {
  const addPatient = (mrn: string, ownerId: string | null = null) =>
    db
      .insert(patients)
      .values({
        mrn,
        ownerId,
        firstName: "Pat",
        lastName: "Test",
        dateOfBirth: "1980-01-01",
        sex: "female",
        diagnosis: "Synthetic",
      })
      .run();
  const owners = () =>
    Object.fromEntries(
      db
        .select({ mrn: patients.mrn, ownerId: patients.ownerId })
        .from(patients)
        .all()
        .map((row) => [row.mrn, row.ownerId]),
    );

  it("gives them to a doctor, skipping MRNs the doctor already has", async () => {
    const password = "long enough password";
    const ana = await createUser(db, { ...NAMES, email: "ana@example.com", password });
    const ben = await createUser(db, { ...NAMES, email: "ben@example.com", password });
    addPatient("FAKE-001");
    addPatient("FAKE-002");
    addPatient("FAKE-003");
    addPatient("FAKE-002", ana.id);
    addPatient("FAKE-009", ben.id);

    expect(assignUnownedPatients(db, "ANA@example.com")).toEqual({
      assigned: 2,
      skippedMrns: ["FAKE-002"],
    });

    expect(countPatientsByOwner(db)).toEqual(
      new Map([
        [ana.id, 3],
        [ben.id, 1],
        [null, 1],
      ]),
    );
    expect(owners()).toMatchObject({ "FAKE-001": ana.id, "FAKE-003": ana.id, "FAKE-009": ben.id });
    expect(assignUnownedPatients(db, "ben@example.com")).toEqual({ assigned: 1, skippedMrns: [] });
    expect(countPatientsByOwner(db).get(null)).toBeUndefined();
  });

  it("refuses to give patients to a patient account", async () => {
    const password = "long enough password";
    const ana = await createUser(db, { ...NAMES, email: "ana@example.com", password });
    addPatient("FAKE-001", ana.id);
    const [patient] = db.select().from(patients).all();
    db.insert(users)
      .values({
        email: "pat@example.com",
        firstName: "Pat",
        lastName: "Test",
        passwordHash: "h",
        role: "patient",
        patientId: patient!.id,
      })
      .run();
    addPatient("FAKE-002");

    expect(() => assignUnownedPatients(db, "pat@example.com")).toThrow(
      "pat@example.com is a patient account, not a doctor.",
    );
    expect(countPatientsByOwner(db).get(null)).toBe(1);
  });

  it("does nothing for an unknown email", () => {
    addPatient("FAKE-001");

    expect(assignUnownedPatients(db, "nobody@example.com")).toBeUndefined();
    expect(countPatientsByOwner(db)).toEqual(new Map([[null, 1]]));
  });
});
