import {
  type AuthorizationRequest,
  type CodeExchange,
  GoogleOAuth,
  type GoogleIdTokenClaims,
} from "../../src/auth/google-oauth.js";

export const FAKE_CLIENT_ID = "fake-client.apps.googleusercontent.com";

/**
 * Stands in for Google: the authorization URL carries the request's values,
 * and `exchangeCode` returns claims for the last request (overridable per test).
 */
export class FakeGoogleOAuth extends GoogleOAuth {
  readonly requests: AuthorizationRequest[] = [];
  readonly exchanges: CodeExchange[] = [];
  /** Claims returned by the next exchanges; `nonce` defaults to the last request's. */
  claims: Partial<GoogleIdTokenClaims> = {};
  /** Makes the exchange fail, as when Google refuses the code. */
  fail = false;

  authorizationUrl(request: AuthorizationRequest): string {
    this.requests.push(request);
    const url = new URL("https://accounts.example.test/auth");
    url.search = new URLSearchParams({ ...request }).toString();
    return url.toString();
  }

  async exchangeCode(exchange: CodeExchange): Promise<GoogleIdTokenClaims> {
    this.exchanges.push(exchange);
    if (this.fail) throw new Error("invalid_grant");
    return {
      iss: "https://accounts.google.com",
      aud: FAKE_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: "ana@example.com",
      email_verified: true,
      name: "Ana Example",
      nonce: this.requests.at(-1)?.nonce,
      ...this.claims,
    };
  }
}
