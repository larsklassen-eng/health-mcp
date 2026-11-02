"use client";

import type * as PasswordRules from "@health-mcp/shared/password";
import { useActionState, useEffect, useState } from "react";

import { register, type RegisterState } from "./actions";

const STRENGTH = ["Very weak", "Weak", "Fair", "Strong", "Very strong"] as const;

/**
 * Sign-up: names, email and a password checked as it is typed, with the same
 * rules the api enforces. The rules (and zxcvbn's dictionaries, a few MB) load
 * after the page; until then the api's answer is the only check.
 */
export function RegisterForm() {
  const [state, action, pending] = useActionState<RegisterState, FormData>(register, {});
  const [rules, setRules] = useState<typeof PasswordRules>();
  const [firstName, setFirstName] = useState(state.firstName ?? "");
  const [lastName, setLastName] = useState(state.lastName ?? "");
  const [email, setEmail] = useState(state.email ?? "");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let mounted = true;
    void import("@health-mcp/shared/password").then((module) => mounted && setRules(module));
    return () => {
      mounted = false;
    };
  }, []);

  const owner = { email, firstName, lastName };
  const check = rules && password ? rules.checkPassword(password, owner) : undefined;
  const matches = repeat === password;
  const ready = password !== "" && matches && (check?.ok ?? !rules);

  function suggest() {
    if (!rules) return;
    let suggestion = rules.suggestPassword();
    while (!rules.checkPassword(suggestion, owner).ok) suggestion = rules.suggestPassword();
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
        <div id="register-password-help" className="password-help" aria-live="polite">
          {check ? (
            <>
              <div className="password-strength">
                <meter min={0} max={4} low={2} high={3} optimum={4} value={check.score} />
                <span>{STRENGTH[check.score]}</span>
              </div>
              <p className={check.ok ? "muted small" : "field-error"}>
                {check.ok ? "Good password." : check.problem}
              </p>
              {!check.ok && check.suggestions.length > 0 && (
                <ul className="muted small">
                  {check.suggestions.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="muted small">
              At least 12 characters, hard to guess, without your name or email. Several unrelated
              words work well.
            </p>
          )}
        </div>
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
