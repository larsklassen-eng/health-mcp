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
  fetchMock.mockResolvedValueOnce(new Response(body === undefined ? null : JSON.stringify(body), { status }));

describe("api client", () => {
  it("uses API_URL", () => {
    expect(apiUrl()).toBe("http://api.test");
  });

  it("lists patients from GET /patients without caching", async () => {
    respond(200, { patients: [{ id: "p1", mrn: "FAKE-001", firstName: "Ana", lastName: "Test", status: "active", diagnosis: "x" }] });

    const patients = await api.listPatients();

    expect(patients).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/patients");
    expect(init?.cache).toBe("no-store");
  });

  it("creates a patient with a JSON POST", async () => {
    respond(201, patient);

    const created = await api.createPatient({ mrn: "FAKE-001", firstName: "Ana", lastName: "Test", dateOfBirth: "1980-01-01", sex: "female", diagnosis: "x" });

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
      messages: [{ id: "m1", patientId: "p1", role: "user", content: "Hi", createdAt: "2026-10-01T10:00:00.000Z" }],
    });

    const messages = await api.getChatHistory("p1");

    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/patients/p1/chat");
    expect(messages).toEqual([expect.objectContaining({ id: "m1", content: "Hi", toolCalls: [] })]);
  });

  it.each([404, 400])("returns null from getChatHistory on %i", async (status) => {
    respond(status, { statusCode: status, error: "x", message: "x" });
    await expect(api.getChatHistory("missing")).resolves.toBeNull();
  });

  it("throws ApiRequestError with the api's error body", async () => {
    respond(409, { statusCode: 409, error: "Conflict", message: "A patient with MRN FAKE-001 already exists" });

    const error = await api.createPatient({ mrn: "FAKE-001", firstName: "A", lastName: "B", dateOfBirth: "1980-01-01", sex: "male", diagnosis: "x" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 409, message: "A patient with MRN FAKE-001 already exists" });
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
