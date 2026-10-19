// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiRequestError, ApiUnavailableError, apiUrl } from "@/lib/api-client";

const patient = {
  id: "p1",
  mrn: "FAKE-001",
  firstName: "Ana",
  lastName: "Test",
  dateOfBirth: "1980-01-01",
  sex: "female",
  status: "active",
  diagnosis: "Synthetic meningioma",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
afterEach(() => fetchMock.mockReset());

const respond = (status: number, body?: unknown) =>
  fetchMock.mockResolvedValueOnce(
    new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );

describe("api client", () => {
  it("uses API_URL", () => {
    expect(apiUrl()).toBe("http://api.test");
  });

  it("lists patients from GET /patients without caching", async () => {
    respond(200, {
      patients: [
        {
          id: "p1",
          mrn: "FAKE-001",
          firstName: "Ana",
          lastName: "Test",
          status: "active",
          diagnosis: "x",
        },
      ],
    });

    const patients = await api.listPatients();

    expect(patients).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/patients");
    expect(init?.cache).toBe("no-store");
  });

  it("creates a patient with a JSON POST", async () => {
    respond(201, patient);

    const created = await api.createPatient({
      mrn: "FAKE-001",
      firstName: "Ana",
      lastName: "Test",
      dateOfBirth: "1980-01-01",
      sex: "female",
      diagnosis: "x",
    });

    expect(created.id).toBe("p1");
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toMatchObject({ mrn: "FAKE-001" });
  });

  it.each([404, 400])("returns null from getPatient on %i", async (status) => {
    respond(status, { statusCode: status, error: "x", message: "x" });
    await expect(api.getPatient("missing")).resolves.toBeNull();
  });

  it("encodes the patient id in the URL", async () => {
    respond(200, patient);
    await api.getPatient("a/b");
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/patients/a%2Fb");
  });

  it("reads a patient's chat history from GET /patients/:id/chat", async () => {
    respond(200, {
      messages: [
        {
          id: "m1",
          patientId: "p1",
          role: "user",
          content: "Hi",
          createdAt: "2026-10-01T10:00:00.000Z",
        },
      ],
    });

    const messages = await api.getChatHistory("p1");

    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/patients/p1/chat");
    expect(messages).toEqual([expect.objectContaining({ id: "m1", content: "Hi", toolCalls: [] })]);
  });

  it.each([404, 400])("returns null from getChatHistory on %i", async (status) => {
    respond(status, { statusCode: status, error: "x", message: "x" });
    await expect(api.getChatHistory("missing")).resolves.toBeNull();
  });

  it("updates a patient with PATCH", async () => {
    respond(200, patient);

    await api.updatePatient("p1", { notes: null });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/patients/p1");
    expect(init).toMatchObject({ method: "PATCH", body: JSON.stringify({ notes: null }) });
  });

  it("deletes a patient with DELETE, accepting an empty 204", async () => {
    respond(204);

    await expect(api.deletePatient("p1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "DELETE" });
  });

  it("sends a tool call decision", async () => {
    respond(200, {
      id: "t1",
      name: "log_symptom",
      input: {},
      isError: false,
      confirmation: "rejected",
    });

    const call = await api.decideToolCall("p1", "t1", "reject");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/patients/p1/chat/tool-calls/t1/decision");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ decision: "reject" }) });
    expect(call.confirmation).toBe("rejected");
  });

  it("gets, updates and deletes an imaging study", async () => {
    const study = {
      id: "s1",
      patientId: "p1",
      modality: "MR",
      studyDate: "2026-08-18",
      source: "import",
      series: [],
      createdAt: "2026-10-01T10:00:00.000Z",
    };
    respond(200, study);
    respond(200, { ...study, report: "Synthetic." });
    respond(204);

    expect(await api.getImagingStudy("p1", "s1")).toMatchObject({ id: "s1" });
    expect(await api.updateImagingStudy("p1", "s1", { report: "Synthetic." })).toMatchObject({
      report: "Synthetic.",
    });
    await api.deleteImagingStudy("p1", "s1");

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
      ["http://api.test/patients/p1/imaging/s1", "GET"],
      ["http://api.test/patients/p1/imaging/s1", "PATCH"],
      ["http://api.test/patients/p1/imaging/s1", "DELETE"],
    ]);
  });

  it("returns null for a missing imaging study", async () => {
    respond(404, { statusCode: 404, error: "x", message: "x" });
    await expect(api.getImagingStudy("p1", "nope")).resolves.toBeNull();
  });

  it("gets the dashboard overview", async () => {
    respond(200, { totalPatients: 0, activePatients: 0, abnormalLabsLast7Days: 0, patients: [] });

    const overview = await api.getDashboardOverview();

    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/dashboards/overview");
    expect(overview.totalPatients).toBe(0);
  });

  it("gets a patient's dashboard", async () => {
    const empty = { latestVitals: [], vitalTrends: [], recentLabs: [], activeMedications: [] };
    respond(200, { patient, ...empty, recentSymptoms: [], milestones: [], imagingStudies: [] });

    const dashboard = await api.getPatientDashboard("p 1");

    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/dashboards/patients/p%201");
    expect(dashboard?.patient.id).toBe("p1");
  });

  it.each([404, 400])("returns null from getPatientDashboard on %i", async (status) => {
    respond(status, { statusCode: status, error: "x", message: "x" });
    await expect(api.getPatientDashboard("missing")).resolves.toBeNull();
  });

  it("throws ApiRequestError with the api's error body", async () => {
    respond(409, {
      statusCode: 409,
      error: "Conflict",
      message: "A patient with MRN FAKE-001 already exists",
    });

    const error = await api
      .createPatient({
        mrn: "FAKE-001",
        firstName: "A",
        lastName: "B",
        dateOfBirth: "1980-01-01",
        sex: "male",
        diagnosis: "x",
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 409,
      message: "A patient with MRN FAKE-001 already exists",
    });
  });

  it("throws ApiUnavailableError when the api cannot be reached", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(api.listPatients()).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it("rejects responses that do not match the shared schema", async () => {
    respond(200, { patients: [{ id: "p1" }] });
    await expect(api.listPatients()).rejects.toThrow();
  });
});
