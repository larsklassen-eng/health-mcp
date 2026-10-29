import { z } from "zod";

/** The ID token claims the api checks (https://developers.google.com/identity/openid-connect). */
export const GoogleIdTokenClaimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  /** Seconds since the epoch. */
  exp: z.number(),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
  nonce: z.string().optional(),
});

export type GoogleIdTokenClaims = z.infer<typeof GoogleIdTokenClaimsSchema>;

export interface AuthorizationRequest {
  redirectUri: string;
  state: string;
  nonce: string;
  /** PKCE: base64url SHA-256 of the code verifier. */
  codeChallenge: string;
}

export interface CodeExchange {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

/** Google's OAuth endpoints. Replaced by a fake in tests. */
export abstract class GoogleOAuth {
  abstract authorizationUrl(request: AuthorizationRequest): string;
  /** Exchanges the code Google returned for the ID token's claims; throws if Google refuses. */
  abstract exchangeCode(exchange: CodeExchange): Promise<GoogleIdTokenClaims>;
}

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const TokenResponseSchema = z.object({ id_token: z.string() });

export class HttpGoogleOAuth extends GoogleOAuth {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {
    super();
  }

  authorizationUrl({ redirectUri, state, nonce, codeChallenge }: AuthorizationRequest): string {
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return url.toString();
  }

  async exchangeCode({ code, codeVerifier, redirectUri }: CodeExchange) {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        code_verifier: codeVerifier,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Google token endpoint: ${response.status}`);
    const { id_token } = TokenResponseSchema.parse(await response.json());
    // The token comes straight from Google over TLS, authenticated with the
    // client secret, so its signature need not be checked again (OpenID
    // Connect Core 3.1.3.7). The claims are still checked by AuthService.
    const payload = id_token.split(".")[1] ?? "";
    return GoogleIdTokenClaimsSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
  }
}
