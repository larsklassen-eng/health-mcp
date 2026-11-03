import { users, type UserRow } from "@health-mcp/db";
import type {
  CreatePatientAccountInput,
  PatientAccount,
  ResetPatientPasswordInput,
} from "@health-mcp/shared";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { eq } from "drizzle-orm";

import { hashPassword } from "../auth/password.js";
import { createUser, emailProblem, findUserByEmail, passwordProblem } from "../auth/users.js";
import { isUniqueViolation } from "../common/sqlite-errors.js";
import { DatabaseService } from "../database/database.service.js";
import { PatientsService } from "./patients.service.js";

const toPatientAccount = (user: UserRow): PatientAccount => ({
  email: user.email,
  mustChangePassword: user.mustChangePassword,
  createdAt: user.createdAt,
});

/**
 * A patient's own account, managed by their doctor (the routes are under
 * `/patients/:id`, so only the patient's doctor reaches them). The doctor sets
 * a temporary password, checked against the password rules with the
 * patient's names and email; the patient must replace it at first sign-in.
 */
@Injectable()
export class PatientAccountService {
  constructor(
    private readonly database: DatabaseService,
    private readonly patients: PatientsService,
  ) {}

  get(patientId: string): PatientAccount | null {
    const account = this.find(patientId);
    return account ? toPatientAccount(account) : null;
  }

  async create(patientId: string, input: CreatePatientAccountInput): Promise<PatientAccount> {
    const patient = this.patients.get(patientId);
    if (this.find(patientId)) throw new ConflictException("This patient already has an account.");
    const owner = { email: input.email, firstName: patient.firstName, lastName: patient.lastName };
    const problem = emailProblem(input.email) ?? passwordProblem(input.password, owner);
    if (problem) throw new BadRequestException(problem);
    const taken = new ConflictException("An account with this email exists.");
    if (findUserByEmail(this.database.db, input.email)) throw taken;

    try {
      return toPatientAccount(
        await createUser(this.database.db, { ...owner, ...input, patientId }),
      );
    } catch (error) {
      // Created at the same moment, for this patient or with this email.
      if (isUniqueViolation(error) || findUserByEmail(this.database.db, input.email)) throw taken;
      throw error;
    }
  }

  /** A new temporary password; the patient's sessions end. */
  async resetPassword(
    patientId: string,
    { password }: ResetPatientPasswordInput,
  ): Promise<PatientAccount> {
    const account = this.require(patientId);
    const problem = passwordProblem(password, account);
    if (problem) throw new BadRequestException(problem);
    const updated = this.database.db
      .update(users)
      .set({
        passwordHash: await hashPassword(password),
        passwordChangedAt: new Date().toISOString(),
        mustChangePassword: true,
      })
      .where(eq(users.id, account.id))
      .returning()
      .get();
    return toPatientAccount(updated);
  }

  /** Deletes the account (and so its sessions); the patient record stays. */
  remove(patientId: string): void {
    const account = this.require(patientId);
    this.database.db.delete(users).where(eq(users.id, account.id)).run();
  }

  private find(patientId: string): UserRow | undefined {
    return this.database.db.select().from(users).where(eq(users.patientId, patientId)).get();
  }

  private require(patientId: string): UserRow {
    const account = this.find(patientId);
    if (!account) throw new NotFoundException("This patient has no account.");
    return account;
  }
}
