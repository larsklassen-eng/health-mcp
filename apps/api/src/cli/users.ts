import "../load-env.js";

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import { createDb, resolveDatabasePath } from "@health-mcp/db";
import { PASSWORD_MIN_LENGTH } from "@health-mcp/shared";

import { createUser, listUsers, passwordProblem, removeUser, setPassword } from "../auth/users.js";
import { promptHidden } from "./prompt.js";

/*
 * Manages who may sign in (AUTH_MODE=password); there is no sign-up page.
 *
 *   yarn user add <email> [--name "Full Name"] [--generate]
 *   yarn user password <email> [--generate]   new password; signs them out everywhere
 *   yarn user remove <email>                   deletes the user and ends their sessions
 *   yarn user list
 *
 * Passwords are typed twice without echo, or made up with --generate and
 * printed once. Works on the database in DATABASE_PATH (default data/health.db);
 * in Docker: `docker compose exec api node apps/api/dist/cli/users.js add <email>`.
 */

const USAGE = `Usage:
  yarn user add <email> [--name "Full Name"] [--generate]
  yarn user password <email> [--generate]
  yarn user remove <email>
  yarn user list`;

/** A random password of 20 characters (letters, digits, - and _). */
const generatePassword = () => randomBytes(15).toString("base64url");

async function newPassword(generate: boolean): Promise<string> {
  if (generate) return generatePassword();
  const password = await promptHidden(`Password (at least ${PASSWORD_MIN_LENGTH} characters): `);
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  if (process.stdin.isTTY && (await promptHidden("Repeat the password: ")) !== password)
    throw new Error("The passwords do not match.");
  return password;
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { name: { type: "string" }, generate: { type: "boolean", default: false } },
  });
  const [command, email] = positionals;
  const needsEmail = command === "add" || command === "password" || command === "remove";
  if (!command || (needsEmail && !email) || !(needsEmail || command === "list")) {
    console.error(USAGE);
    return 2;
  }

  const connection = createDb({ path: resolveDatabasePath() });
  try {
    const { db } = connection;
    switch (command) {
      case "add": {
        const password = await newPassword(values.generate);
        const user = await createUser(db, { email: email!, password, name: values.name });
        console.log(`Added ${user.email}.`);
        if (values.generate) console.log(`Password (shown once): ${password}`);
        break;
      }
      case "password": {
        const password = await newPassword(values.generate);
        if (!(await setPassword(db, email!, password))) throw new Error(`No user ${email}.`);
        console.log(`Changed the password of ${email}; their sessions have ended.`);
        if (values.generate) console.log(`Password (shown once): ${password}`);
        break;
      }
      case "remove":
        if (!removeUser(db, email!)) throw new Error(`No user ${email}.`);
        console.log(`Removed ${email}; their sessions have ended.`);
        break;
      case "list": {
        const rows = listUsers(db);
        if (rows.length === 0) console.log("No users yet. Add one with `yarn user add <email>`.");
        for (const user of rows)
          console.log(
            `${user.email}${user.name ? ` (${user.name})` : ""}, since ${user.createdAt}`,
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
