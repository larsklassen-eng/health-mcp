import "../load-env.js";

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import { createDb, resolveDatabasePath } from "@health-mcp/db";
import { PASSWORD_MIN_LENGTH } from "@health-mcp/shared";
import type { PasswordOwner } from "@health-mcp/shared/password";

import {
  assignUnownedPatients,
  countPatientsByOwner,
  createUser,
  findUserByEmail,
  listUsers,
  nameProblem,
  passwordProblem,
  removeUser,
  setPassword,
} from "../auth/users.js";
import { promptHidden } from "./prompt.js";

/*
 * Manages the doctors who may sign in (AUTH_MODE=password), besides sign-up.
 *
 *   yarn user add <email> --first <name> --last <name> [--generate]
 *   yarn user password <email> [--generate]   new password; signs them out everywhere
 *   yarn user remove <email>                   deletes the user and ends their sessions
 *   yarn user assign <email>                   gives them the patients without an owner
 *   yarn user list                             with their number of patients
 *
 * Passwords are typed twice without echo, or made up with --generate and
 * printed once. Works on the database in DATABASE_PATH (default data/health.db);
 * in Docker: `docker compose exec api node apps/api/dist/cli/users.js add <email>`.
 */

const USAGE = `Usage:
  yarn user add <email> --first <name> --last <name> [--generate]
  yarn user password <email> [--generate]
  yarn user remove <email>
  yarn user assign <email>
  yarn user list`;

/** A random password of 20 characters (letters, digits, - and _) that meets the rules. */
function generatePassword(owner: PasswordOwner): string {
  for (;;) {
    const password = randomBytes(15).toString("base64url");
    if (!passwordProblem(password, owner)) return password;
  }
}

async function newPassword(generate: boolean, owner: PasswordOwner): Promise<string> {
  if (generate) return generatePassword(owner);
  const password = await promptHidden(
    `Password (at least ${PASSWORD_MIN_LENGTH} characters, hard to guess): `,
  );
  const problem = passwordProblem(password, owner);
  if (problem) throw new Error(problem);
  if (process.stdin.isTTY && (await promptHidden("Repeat the password: ")) !== password)
    throw new Error("The passwords do not match.");
  return password;
}

const patientCount = (n: number) => `${n} patient${n === 1 ? "" : "s"}`;

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      first: { type: "string" },
      last: { type: "string" },
      generate: { type: "boolean", default: false },
    },
  });
  const [command, email] = positionals;
  const needsEmail = ["add", "password", "remove", "assign"].includes(command ?? "");
  const needsNames = command === "add" && !(values.first && values.last);
  if (!command || (needsEmail && !email) || needsNames || !(needsEmail || command === "list")) {
    console.error(USAGE);
    return 2;
  }

  const connection = createDb({ path: resolveDatabasePath() });
  try {
    const { db } = connection;
    switch (command) {
      case "add": {
        const problem = nameProblem(values.first!, values.last!);
        if (problem) throw new Error(problem);
        const owner = { email, firstName: values.first, lastName: values.last };
        const password = await newPassword(values.generate, owner);
        const user = await createUser(db, {
          email: email!,
          password,
          firstName: values.first!,
          lastName: values.last!,
        });
        console.log(`Added ${user.email}.`);
        if (values.generate) console.log(`Password (shown once): ${password}`);
        break;
      }
      case "password": {
        const user = findUserByEmail(db, email!);
        if (!user) throw new Error(`No user ${email}.`);
        const password = await newPassword(values.generate, user);
        if (!(await setPassword(db, email!, password))) throw new Error(`No user ${email}.`);
        console.log(`Changed the password of ${email}; their sessions have ended.`);
        if (values.generate) console.log(`Password (shown once): ${password}`);
        break;
      }
      case "remove":
        if (!removeUser(db, email!)) throw new Error(`No user ${email}.`);
        console.log(`Removed ${email}; their sessions have ended.`);
        break;
      case "assign": {
        const result = assignUnownedPatients(db, email!);
        if (!result) throw new Error(`No user ${email}.`);
        const { assigned, skippedMrns } = result;
        console.log(`Gave ${patientCount(assigned)} without an owner to ${email}.`);
        if (skippedMrns.length > 0)
          console.log(
            `Skipped ${patientCount(skippedMrns.length)} whose MRN they already have: ` +
              skippedMrns.join(", "),
          );
        break;
      }
      case "list": {
        const rows = listUsers(db);
        const counts = countPatientsByOwner(db);
        if (rows.length === 0) console.log("No users yet. Add one with `yarn user add <email>`.");
        for (const user of rows) {
          const name = `${user.firstName} ${user.lastName}`.trim();
          const role =
            user.role === "patient"
              ? "patient account"
              : `doctor, ${patientCount(counts.get(user.id) ?? 0)}`;
          console.log(`${user.email}${name ? ` (${name})` : ""}, ${role}, since ${user.createdAt}`);
        }
        const unowned = counts.get(null) ?? 0;
        if (unowned > 0)
          console.log(
            `${patientCount(unowned)} without an owner; give them to a doctor with ` +
              "`yarn user assign <email>`.",
          );
        break;
      }
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      /no such table: users/.test(message)
        ? "The users table is missing. Run `yarn db:migrate` first."
        : message,
    );
    return 1;
  } finally {
    connection.close();
  }
}

process.exitCode = await main();
