import { afterEach, describe, expect, it, vi } from "vitest";

import { QuietStartupLogger } from "../src/common/quiet-startup-logger.js";

afterEach(() => vi.restoreAllMocks());

describe("QuietStartupLogger", () => {
  it("skips the per-module and per-route startup lines, and keeps other logs", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const logger = new QuietStartupLogger();

    logger.log("AppModule dependencies initialized", "InstanceLoader");
    logger.log("Mapped {/health, GET} route", "RouterExplorer");
    logger.log("Opened SQLite database", "DatabaseService");

    const output = write.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("Opened SQLite database");
    expect(output).not.toContain("Mapped");
    expect(output).not.toContain("dependencies initialized");
  });

  it("still shows warnings and errors from startup contexts", () => {
    // Nest writes warnings to stdout and errors to stderr.
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = new QuietStartupLogger();

    logger.warn("Route conflict", "RouterExplorer");
    logger.error("Module failed", undefined, "InstanceLoader");

    const text = (spy: typeof stdout) => spy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(text(stdout)).toContain("Route conflict");
    expect(text(stderr)).toContain("Module failed");
  });
});
