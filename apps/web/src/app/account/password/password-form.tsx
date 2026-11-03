"use client";

import type { PasswordOwner } from "@health-mcp/shared/password";
import { useActionState, useState } from "react";

import { PasswordStrength, suggestFor, usePasswordRules } from "../../password-strength";
import { changePassword, type ChangePasswordState } from "./actions";

/** Current password, then a new one checked as it is typed (the api checks again). */
export function PasswordForm({ owner }: { owner: PasswordOwner }) {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(
    changePassword,
    {},
  );
  const rules = usePasswordRules();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [shown, setShown] = useState(false);

  const check = rules && password ? rules.checkPassword(password, owner) : undefined;
  const same = password !== "" && password === current;
  const matches = repeat === password;
  const ready = current !== "" && password !== "" && matches && !same && (check?.ok ?? !rules);
  const type = shown ? "text" : "password";

  function suggest() {
    if (!rules) return;
    const suggestion = suggestFor(rules, owner);
    setPassword(suggestion);
    setRepeat(suggestion);
    setShown(true);
  }

  return (
    <form action={action} className="login-form">
      {state.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      {/* For password managers: whose password this is. */}
      <input type="hidden" name="username" autoComplete="username" value={owner.email ?? ""} />
      <div className="field">
        <label htmlFor="current-password">Current password</label>
        <input
          id="current-password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          maxLength={200}
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </div>
      <div className="field">
        <div className="field-label-row">
          <label htmlFor="new-password">New password</label>
          <button type="button" className="link-button small" onClick={suggest} disabled={!rules}>
            Suggest a strong password
          </button>
        </div>
        <div className="password-row">
          <input
            id="new-password"
            name="newPassword"
            type={type}
            autoComplete="new-password"
            required
            maxLength={200}
            aria-describedby="new-password-help"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            className="button secondary"
            aria-pressed={shown}
            onClick={() => setShown(!shown)}
          >
            {shown ? "Hide" : "Show"}
          </button>
        </div>
        <PasswordStrength
          id="new-password-help"
          check={check}
          hint="At least 12 characters, hard to guess, without your name or email."
        />
        {same && <p className="field-error">Choose a password different from the current one.</p>}
      </div>
      <div className="field">
        <label htmlFor="repeat-password">Repeat the new password</label>
        <input
          id="repeat-password"
          name="repeatPassword"
          type={type}
          autoComplete="new-password"
          required
          maxLength={200}
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
        />
        {repeat !== "" && !matches && <p className="field-error">The passwords differ.</p>}
      </div>
      <button type="submit" className="button" disabled={pending || !ready}>
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
