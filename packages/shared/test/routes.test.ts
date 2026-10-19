import { describe, expect, it } from "vitest";

import { API_ROUTES } from "../src/index.js";

describe("API_ROUTES", () => {
  it("builds patient routes", () => {
    expect(API_ROUTES.patient("p1")).toBe("/patients/p1");
    expect(API_ROUTES.patientChat("p1")).toBe("/patients/p1/chat");
    expect(API_ROUTES.patientDashboard("p1")).toBe("/dashboards/patients/p1");
    expect(API_ROUTES.toolCallDecision("p1", "t1")).toBe(
      "/patients/p1/chat/tool-calls/t1/decision",
    );
  });

  it("encodes ids so they cannot change the path", () => {
    expect(API_ROUTES.patient("FAKE 001")).toBe("/patients/FAKE%20001");
    expect(API_ROUTES.patientChat("../admin")).toBe("/patients/..%2Fadmin/chat");
    expect(API_ROUTES.toolCallDecision("p1", "../x")).toBe(
      "/patients/p1/chat/tool-calls/..%2Fx/decision",
    );
  });
});
