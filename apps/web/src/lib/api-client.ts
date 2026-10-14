import {
  API_ROUTES,
  type ApiError,
  ApiErrorSchema,
  ChatHistoryResponseSchema,
  type ChatMessage,
  type CreatePatientInput,
  type Patient,
  type PatientImportResult,
  PatientImportResultSchema,
  PatientListResponseSchema,
  PatientSchema,
  type PatientSummary,
} from "@health-mcp/shared";

/*
 * Server-side client for apps/api. Only server components and server actions
 * use it, so the api URL never reaches the browser and no CORS is involved.
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

async function request<T>(path: string, schema: { parse: (value: unknown) => T }, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl()}${path}`, {
      ...init,
      cache: "no-store",
      headers: { Accept: "application/json", ...(init.body !== undefined && { "Content-Type": "application/json" }) },
    });
  } catch (cause) {
    throw new ApiUnavailableError(cause);
  }

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new ApiRequestError(response.status, ApiErrorSchema.safeParse(body).data);
  return schema.parse(body);
}

export const api = {
  async listPatients(): Promise<PatientSummary[]> {
    return (await request(API_ROUTES.patients, PatientListResponseSchema)).patients;
  },

  /** Returns `null` when the patient does not exist. */
  async getPatient(id: string): Promise<Patient | null> {
    try {
      return await request(API_ROUTES.patient(id), PatientSchema);
    } catch (error) {
      if (error instanceof ApiRequestError && (error.status === 404 || error.status === 400)) return null;
      throw error;
    }
  },

  /** A patient's chat, oldest message first. Returns `null` when the patient does not exist. */
  async getChatHistory(patientId: string): Promise<ChatMessage[] | null> {
    try {
      return (await request(API_ROUTES.patientChat(patientId), ChatHistoryResponseSchema)).messages;
    } catch (error) {
      if (error instanceof ApiRequestError && (error.status === 404 || error.status === 400)) return null;
      throw error;
    }
  },

  createPatient(input: CreatePatientInput): Promise<Patient> {
    return request(API_ROUTES.patients, PatientSchema, { method: "POST", body: JSON.stringify(input) });
  },

  /** `file` is sent as-is; the api validates it again and applies defaults. */
  importPatients(file: unknown): Promise<PatientImportResult> {
    return request(API_ROUTES.patientsImport, PatientImportResultSchema, { method: "POST", body: JSON.stringify(file) });
  },
};
