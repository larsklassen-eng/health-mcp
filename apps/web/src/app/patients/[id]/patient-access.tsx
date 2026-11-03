"use client";

import type { PatientAccount } from "@health-mcp/shared";
import { type FormEvent, useActionState, useEffect, useState } from "react";

import { formatDate } from "@/lib/format";

import { PasswordStrength, suggestFor, usePasswordRules } from "../../password-strength";
import type { PatientAccessState } from "./access-actions";

interface Props {
  account: PatientAccount | null;
  patient: { firstName: string; lastName: string };
  /** `patientAccessAction` bound to the patient's id. */
  action: (state: PatientAccessState, form: FormData) => Promise<PatientAccessState>;
}

/**
 * The doctor's controls for a patient's own sign-in: create it with a
 * temporary password (shown once, to pass on), reset that password, or
 * remove the account. The patient then sees their own record, read-only.
 */
export function PatientAccess({ account, patient, action }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [resetting, setResetting] = useState(false);
  // A new temporary password was set: close the reset form, the details show above.
  useEffect(() => {
    if (state.issued) setResetting(false);
  }, [state]);

  function confirmRemove(event: FormEvent<HTMLFormElement>) {
    const confirmed = window.confirm(
      `Remove ${patient.firstName}'s access? They can no longer sign in; their record stays.`,
    );
    if (!confirmed) event.preventDefault();
  }

  return (
    <section className="card patient-access" aria-labelledby="patient-access-title">
      <h2 id="patient-access-title">Patient access</h2>
      {state.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      {state.issued && <IssuedDetails issued={state.issued} firstName={patient.firstName} />}

      {account ? (
        <>
          <p>
            <strong>{account.email}</strong>
            <br />
            <span className="muted small">
              {account.mustChangePassword
                ? "Waiting for the first sign-in (temporary password)."
                : "Has signed in and chosen their own password."}{" "}
              Since {formatDate(account.createdAt)}.
            </span>
          </p>
          {resetting ? (
            <TemporaryPasswordForm
              intent="reset"
              owner={{ email: account.email, ...patient }}
              action={formAction}
              pending={pending}
              submitLabel="Set temporary password"
              onCancel={() => setResetting(false)}
            />
          ) : (
            <div className="actions">
              <button type="button" className="button secondary" onClick={() => setResetting(true)}>
                Reset password
              </button>
              <form action={formAction} onSubmit={confirmRemove}>
                <input type="hidden" name="intent" value="remove" />
                <button type="submit" className="button danger" disabled={pending}>
                  Remove access
                </button>
              </form>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="muted">
            Give {patient.firstName} their own sign-in to see their record (profile, recovery
            dashboard and imaging), read-only. They choose their own password the first time they
            sign in.
          </p>
          <TemporaryPasswordForm
            intent="create"
            owner={patient}
            action={formAction}
            pending={pending}
            submitLabel="Create account"
            {...(state.email !== undefined && { initialEmail: state.email })}
          />
        </>
      )}
    </section>
  );
}

/** The sign-in details to pass on; the password is not kept anywhere else. */
function IssuedDetails({
  issued,
  firstName,
}: {
  issued: { email: string; password: string };
  firstName: string;
}) {
  const [copied, setCopied] = useState(false);
  const signInUrl = `${window.location.origin}/login`;
  const text = [
    `Sign in at ${signInUrl}`,
    `Email: ${issued.email}`,
    `Temporary password: ${issued.password}`,
  ].join("\n");

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return (
    <div className="alert success" role="status">
      <p>
        Give {firstName} these sign-in details. The password is shown only now; they will choose
        their own at the first sign-in.
      </p>
      <dl className="issued">
        <dt>Sign in at</dt>
        <dd>{signInUrl}</dd>
        <dt>Email</dt>
        <dd>{issued.email}</dd>
        <dt>Temporary password</dt>
        <dd>
          <code>{issued.password}</code>
        </dd>
      </dl>
      <button type="button" className="button secondary" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy details"}
      </button>
    </div>
  );
}

function TemporaryPasswordForm({
  intent,
  owner,
  initialEmail = "",
  action,
  pending,
  submitLabel,
  onCancel,
}: {
  intent: "create" | "reset";
  owner: { email?: string; firstName: string; lastName: string };
  initialEmail?: string;
  action: (form: FormData) => void;
  pending: boolean;
  submitLabel: string;
  onCancel?: () => void;
}) {
  const rules = usePasswordRules();
  const [email, setEmail] = useState(owner.email ?? initialEmail);
  const [password, setPassword] = useState("");
  const forOwner = { ...owner, email };
  const check = rules && password ? rules.checkPassword(password, forOwner) : undefined;
  const ready = password !== "" && (intent === "reset" || email !== "") && (check?.ok ?? !rules);

  return (
    <form action={action} className="login-form">
      <input type="hidden" name="intent" value={intent} />
      {intent === "create" && (
        <div className="field">
          <label htmlFor="access-email">Patient&apos;s email</label>
          <input
            id="access-email"
            name="email"
            type="email"
            required
            maxLength={320}
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
      )}
      <div className="field">
        <div className="field-label-row">
          <label htmlFor="access-password">Temporary password</label>
          <button
            type="button"
            className="link-button small"
            disabled={!rules}
            onClick={() => rules && setPassword(suggestFor(rules, forOwner))}
          >
            Suggest a strong password
          </button>
        </div>
        {/* Shown as typed: the doctor passes it on to the patient. */}
        <input
          id="access-password"
          name="password"
          type="text"
          required
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          aria-describedby="access-password-help"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <PasswordStrength
          id="access-password-help"
          check={check}
          hint="At least 12 characters, hard to guess, without the patient's name or email."
        />
      </div>
      <div className="actions">
        <button type="submit" className="button" disabled={pending || !ready}>
          {pending ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="button secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
