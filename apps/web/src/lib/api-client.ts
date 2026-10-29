import {
  API_ROUTES,
  type ApiError,
  ApiErrorSchema,
  type AuthSessionResponse,
  AuthSessionResponseSchema,
  ChatHistoryResponseSchema,
  type ChatMessage,
  type CreatePatientInput,
  type DashboardOverview,
  type ImagingStudy,
  type LoginInput,
  type LoginResponse,
  LoginResponseSchema,
  ImagingStudySchema,
  DashboardOverviewSchema,
  type Patient,
  type PatientDashboard,
  PatientDashboardSchema,
  type PatientImportResult,
  PatientImportResultSchema,
  PatientListResponseSchema,
  PatientSchema,
  type PatientSummary,
  type ToolCall,
  type ToolCallDecisionRequest,
  ToolCallSchema,
  type UpdateImagingStudyInput,
  type UpdatePatientInput,
} from "@health-mcp/shared";
import { redirect } from "next/navigation";

import { LOGIN_PATH, sessionHeaders } from "./session";

/*
 * Server-side client for apps/api. Only server components, server actions and
 * route handlers use it, so the api URL never reaches the browser and no CORS
 * is involved. Each request carries the signed-in user's session.
 */

export const DEFAULT_API_URL = "http://localhost:3001";
export const apiUrl = (): string => process.env.API_URL ?? DEFAULT_API_URL;

/** The api answered with an error status; `body` is the shared `ApiError` when it parsed. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | undefined,
  ) {
    super(body?.message ?? `API request failed with status ${status}`);
    this.name = "ApiRequestError";
  }
}

/** The api could not be reached at all (not running, wrong API_URL). */
export class ApiUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Could not reach the API at ${apiUrl()}`, { cause });
    this.name = "ApiUnavailableError";
  }
}

interface RequestOptions extends RequestInit {
  /**
   * Session token to send instead of the current request's, or null for none
   * (the proxy reads the cookie from its request itself).
   */
  session?: string | null | undefined;
  /** On 401 (signed out), go to the login page instead of throwing. Default true. */
  redirectWhenSignedOut?: boolean;
}

async function request<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  { session, redirectWhenSignedOut = true, ...init }: RequestOptions = {},
): Promise<T> {
  const auth =
    session === undefined
      ? await sessionHeaders()
      : session === null
        ? {}
        : { Authorization: `Bearer ${session}` };
  let response: Response;
  try {
    response = await fetch(`${apiUrl()}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined && { "Content-Type": "application/json" }),
        ...auth,
      },
    });
  } catch (cause) {
    throw new ApiUnavailableError(cause);
  }

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : undefined;
  // The session expired or was revoked since the proxy checked it.
  if (response.status === 401 && redirectWhenSignedOut) redirect(LOGIN_PATH);
  if (!response.ok) throw new ApiRequestError(response.status, ApiErrorSchema.safeParse(body).data);
  return schema.parse(body);
}

/**
 * Resolves to `null` when the api says the patient does not exist (404, or 400
 * for a malformed id).
 */
async function orNullIfMissing<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 400))
      return null;
    throw error;
  }
}

export const api = {
  /**
   * Whether sign-in is on and whose session `session` is (the current
   * request's when omitted). A missing or invalid session gives `user: null`.
   */
  async getSession(session?: string | null): Promise<AuthSessionResponse> {
    try {
      return await request(API_ROUTES.authSession, AuthSessionResponseSchema, {
        ...(session !== undefined && { session }),
        redirectWhenSignedOut: false,
      });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401)
        return { mode: "password", user: null };
      throw error;
    }
  },

  /**
   * Signs in with an email and password. Throws `ApiRequestError` 401 for a
   * wrong email or password, 429 after too many failed attempts.
   */
  login(input: LoginInput): Promise<LoginResponse> {
    return request(API_ROUTES.authLogin, LoginResponseSchema, {
      method: "POST",
      body: JSON.stringify(input),
      session: null,
      redirectWhenSignedOut: false,
    });
  },

  async listPatients(): Promise<PatientSummary[]> {
    return (await request(API_ROUTES.patients, PatientListResponseSchema)).patients;
  },

  /** Returns `null` when the patient does not exist. */
  getPatient(id: string): Promise<Patient | null> {
    return orNullIfMissing(request(API_ROUTES.patient(id), PatientSchema));
  },

  /** A patient's chat, oldest message first. Returns `null` when the patient does not exist. */
  async getChatHistory(patientId: string): Promise<ChatMessage[] | null> {
    const history = await orNullIfMissing(
      request(API_ROUTES.patientChat(patientId), ChatHistoryResponseSchema),
    );
    return history?.messages ?? null;
  },

  /** Confirms (runs) or discards a tool call that waits for the clinician; returns it updated. */
  decideToolCall(
    patientId: string,
    toolCallId: string,
    decision: ToolCallDecisionRequest["decision"],
  ): Promise<ToolCall> {
    return request(API_ROUTES.toolCallDecision(patientId, toolCallId), ToolCallSchema, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
  },

  /** Returns `null` when the patient or the study does not exist. */
  getImagingStudy(patientId: string, studyId: string): Promise<ImagingStudy | null> {
    return orNullIfMissing(
      request(API_ROUTES.imagingStudy(patientId, studyId), ImagingStudySchema),
    );
  },

  updateImagingStudy(
    patientId: string,
    studyId: string,
    input: UpdateImagingStudyInput,
  ): Promise<ImagingStudy> {
    return request(API_ROUTES.imagingStudy(patientId, studyId), ImagingStudySchema, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },

  /** Deletes the study with its images. */
  async deleteImagingStudy(patientId: string, studyId: string): Promise<void> {
    await request(
      API_ROUTES.imagingStudy(patientId, studyId),
      { parse: () => undefined },
      {
        method: "DELETE",
      },
    );
  },

  getDashboardOverview(): Promise<DashboardOverview> {
    return request(API_ROUTES.dashboardOverview, DashboardOverviewSchema);
  },

  /** Returns `null` when the patient does not exist. */
  getPatientDashboard(patientId: string): Promise<PatientDashboard | null> {
    return orNullIfMissing(request(API_ROUTES.patientDashboard(patientId), PatientDashboardSchema));
  },

  createPatient(input: CreatePatientInput): Promise<Patient> {
    return request(API_ROUTES.patients, PatientSchema, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  updatePatient(id: string, input: UpdatePatientInput): Promise<Patient> {
    return request(API_ROUTES.patient(id), PatientSchema, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },

  /** Deletes the patient with all of their records and chat history. */
  async deletePatient(id: string): Promise<void> {
    await request(API_ROUTES.patient(id), { parse: () => undefined }, { method: "DELETE" });
  },

  /** `file` is sent as-is; the api validates it again and applies defaults. */
  importPatients(file: unknown): Promise<PatientImportResult> {
    return request(API_ROUTES.patientsImport, PatientImportResultSchema, {
      method: "POST",
      body: JSON.stringify(file),
    });
  },
};
