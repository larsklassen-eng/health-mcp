import { parseArgs, type ParseArgsConfig } from "node:util";

/**
 * `parseArgs`, but a mistyped option prints one line and the usage instead of
 * a stack trace. Returns undefined then; the runner exits with code 2.
 */
export function parseOptions<T extends ParseArgsConfig>(config: T, usage: string) {
  try {
    return parseArgs(config);
  } catch (error) {
    // Node adds a hint about positional arguments after the first sentence.
    const message = error instanceof Error ? error.message.split(". ")[0] : String(error);
    console.error(`${message}.\nUsage: ${usage}`);
    return undefined;
  }
}
