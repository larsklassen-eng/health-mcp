import { describe, expect, it } from "vitest";

import { provenance, shortHash, toolDefinitionsText } from "../src/index.js";

describe("provenance", () => {
  it("records the commit, the prompt's hash and the tools' hash of this checkout", () => {
    const recorded = provenance();

    expect(recorded.gitCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof recorded.gitDirty).toBe("boolean");
    expect(recorded.systemPromptHash).toMatch(/^[0-9a-f]{12}$/);
    expect(recorded.toolsHash).toBe(shortHash(toolDefinitionsText()));
  });

  it("hashes the tools as the model sees them: name, description and argument schema", () => {
    const tools = JSON.parse(toolDefinitionsText()) as { name: string; description: string }[];
    expect(tools.map((t) => t.name)).toContain("search_patient_records");
    expect(tools.every((t) => t.description.length > 0)).toBe(true);
  });
});
