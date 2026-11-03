"use client";

import type * as PasswordRules from "@health-mcp/shared/password";
import type { PasswordCheck, PasswordOwner } from "@health-mcp/shared/password";
import { useEffect, useState } from "react";

/*
 * The password rules in forms that set a new password (sign-up, a patient's
 * temporary password): the same checks the api enforces, shown while typing.
 */

type Rules = typeof PasswordRules;

const STRENGTH = ["Very weak", "Weak", "Fair", "Strong", "Very strong"] as const;

/**
 * The rules, loaded after the page: zxcvbn's dictionaries are a few MB. Until
 * then (or if loading fails) undefined, and the api's answer is the only check.
 */
export function usePasswordRules(): Rules | undefined {
  const [rules, setRules] = useState<Rules>();
  useEffect(() => {
    let mounted = true;
    void import("@health-mcp/shared/password").then((module) => mounted && setRules(module));
    return () => {
      mounted = false;
    };
  }, []);
  return rules;
}

/** A random password that meets the rules for `owner`. */
export function suggestFor(rules: Rules, owner: PasswordOwner): string {
  let suggestion = rules.suggestPassword();
  while (!rules.checkPassword(suggestion, owner).ok) suggestion = rules.suggestPassword();
  return suggestion;
}

/** The strength meter and what to fix, or `hint` before anything is typed. */
export function PasswordStrength({
  id,
  check,
  hint,
}: {
  id: string;
  check: PasswordCheck | undefined;
  hint: string;
}) {
  return (
    <div id={id} className="password-help" aria-live="polite">
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
        <p className="muted small">{hint}</p>
      )}
    </div>
  );
}
