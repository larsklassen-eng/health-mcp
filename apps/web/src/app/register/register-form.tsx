"use client";

import { useActionState, useState } from "react";

import { PasswordStrength, suggestFor, usePasswordRules } from "../password-strength";
import { register, type RegisterState } from "./actions";

/**
 * Sign-up: names, email and a password checked as it is typed, with the same
 * rules the api enforces. The rules (and zxcvbn's dictionaries, a few MB) load
 * after the page; until then the api's answer is the only check.
 */
export function RegisterForm() {
  const [state, action, pending] = useActionState<RegisterState, FormData>(register, {});
  const rules = usePasswordRules();
  const [firstName, setFirstName] = useState(state.firstName ?? "");
  const [lastName, setLastName] = useState(state.lastName ?? "");
  const [email, setEmail] = useState(state.email ?? "");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [shown, setShown] = useState(false);

  const owner = { email, firstName, lastName };
  const check = rules && password ? rules.checkPassword(password, owner) : undefined;
  const matches = repeat === password;
  const ready = password !== "" && matches && (check?.ok ?? !rules);

  function suggest() {
    if (!rules) return;
    const suggestion = suggestFor(rules, owner);
    setPassword(suggestion);
    setRepeat(suggestion);
    setShown(true);
  }

  const passwordType = shown ? "text" : "password";
  return (
    <form action={action} className="login-form">
      {state.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      <div className="form-row">
        <div className="field">
          <label htmlFor="register-first-name">First name</label>
          <input
            id="register-first-name"
            name="firstName"
            autoComplete="given-name"
            required
            maxLength={100}
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="register-last-name">Last name</label>
          <input
            id="register-last-name"
            name="lastName"
            autoComplete="family-name"
            required
            maxLength={100}
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="register-email">Email</label>
        <input
          id="register-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={320}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="field">
        <div className="field-label-row">
          <label htmlFor="register-password">Password</label>
          <button type="button" className="link-button small" onClick={suggest} disabled={!rules}>
            Suggest a strong password
          </button>
        </div>
        <div className="password-row">
          <input
            id="register-password"
            name="password"
            type={passwordType}
            autoComplete="new-password"
            required
            maxLength={200}
            aria-describedby="register-password-help"
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
          id="register-password-help"
          check={check}
          hint={
            "At least 12 characters, hard to guess, without your name or email. " +
            "Several unrelated words work well."
          }
        />
      </div>
      <div className="field">
        <label htmlFor="register-repeat">Repeat the password</label>
        <input
          id="register-repeat"
          name="repeatPassword"
          type={passwordType}
          autoComplete="new-password"
          required
          maxLength={200}
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
        />
        {repeat !== "" && !matches && <p className="field-error">The passwords differ.</p>}
      </div>
      <button type="submit" className="button" disabled={pending || !ready}>
        {pending ? "Creating your account…" : "Create account"}
      </button>
    </form>
  );
}
