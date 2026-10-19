import {
  API_ROUTES,
  type ApiError,
  ApiErrorSchema,
  ChatHistoryResponseSchema,
  type ChatMessage,
  type CreatePatientInput,
  type DashboardOverview,
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
  type UpdatePatientInput,
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

async function request<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl()}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined && { "Content-Type": "application/json" }),
      },
    });
  } catch (cause) {
    throw new ApiUnavailableError(cause);
  }

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new ApiRequestError(response.status, ApiErrorSchema.safeParse(body).data);
  return schema.parse(body);
}

/** Resolves to `null` when the api says the patient does not exist (404, or 400 for a malformed id). */
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
