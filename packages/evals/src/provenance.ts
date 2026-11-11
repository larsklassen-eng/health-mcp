import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "@health-mcp/db";
import { MCP_TOOLS } from "@health-mcp/shared";
import { z } from "zod";

/*
 * What produced a report, so two reports can be compared knowing what changed
 * between them: the code (git commit, and whether it had uncommitted changes),
 * and the two things the model reads besides the patient's data: the system
 * prompt and the tool definitions. Hashes are short; equal hashes mean the
 * model saw the same instructions.
 */

export interface Provenance {
  /** `HEAD` when the run started; absent outside a git checkout. */
  gitCommit?: string;
  /** Whether the working tree had uncommitted changes (then the commit is not the whole story). */
  gitDirty?: boolean;
  /** Hash of the system prompt's source (apps/api/src/chat/system-prompt.ts). */
  systemPromptHash?: string;
  /** Hash of the tools as the model sees them: names, descriptions and argument schemas. */
  toolsHash: string;
}

export const shortHash = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);

const SYSTEM_PROMPT_SOURCE = path.join(REPO_ROOT, "apps/api/src/chat/system-prompt.ts");

/** The tool definitions as text, the way the model receives them (JSON Schema). */
export const toolDefinitionsText = () =>
  JSON.stringify(
    Object.entries(MCP_TOOLS).map(([name, tool]) => ({
      name,
      description: tool.description,
      args: z.toJSONSchema(tool.args),
    })),
  );

function git(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: "pipe" }).trim();
  } catch {
    return undefined;
  }
}

function fileHash(file: string): string | undefined {
  try {
    return shortHash(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

export function provenance(): Provenance {
  const gitCommit = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain"]);
  const systemPromptHash = fileHash(SYSTEM_PROMPT_SOURCE);
  return {
    ...(gitCommit && { gitCommit }),
    ...(status !== undefined && { gitDirty: status !== "" }),
    ...(systemPromptHash && { systemPromptHash }),
    toolsHash: shortHash(toolDefinitionsText()),
  };
}
