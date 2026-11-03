import { z } from "zod";

import { PASSWORD_MAX_LENGTH } from "./auth.js";
import { IsoDateTimeSchema } from "./common.js";

/*
 * A patient's own account, managed by their doctor: the doctor sets an email
 * and a temporary password, which the patient must change at first sign-in.
 * The account is named after the patient record.
 */

/** `GET /patients/:id/account`, and the answer to creating or resetting one. */
export const PatientAccountSchema = z.object({
  email: z.email(),
  /** True until the patient has replaced the doctor's temporary password. */
  mustChangePassword: z.boolean(),
  createdAt: IsoDateTimeSchema,
});

export const PatientAccountResponseSchema = z.object({
  /** Null when the patient has no account. */
  account: PatientAccountSchema.nullable(),
});

/**
 * `POST /patients/:id/account`. Only types and upper bounds are checked here;
 * the api checks the email and the password rules, so it can say what to fix.
 */
export const CreatePatientAccountInputSchema = z.object({
  email: z.string().trim().max(320),
  password: z.string().max(PASSWORD_MAX_LENGTH),
});

/** `PUT /patients/:id/account/password`: a new temporary password. */
export const ResetPatientPasswordInputSchema = z.object({
  password: z.string().max(PASSWORD_MAX_LENGTH),
});

export type PatientAccount = z.infer<typeof PatientAccountSchema>;
export type PatientAccountResponse = z.infer<typeof PatientAccountResponseSchema>;
export type CreatePatientAccountInput = z.infer<typeof CreatePatientAccountInputSchema>;
export type ResetPatientPasswordInput = z.infer<typeof ResetPatientPasswordInputSchema>;
