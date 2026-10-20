import { ConsoleLogger } from "@nestjs/common";

/** Nest's startup contexts that log one line per module and per route. */
const STARTUP_CONTEXTS = new Set([
  "NestFactory",
  "InstanceLoader",
  "RoutesResolver",
  "RouterExplorer",
]);

/**
 * Nest's console logger without the startup lines that list every module and
 * route (about 35 of them). Warnings and errors from those contexts still show.
 */
export class QuietStartupLogger extends ConsoleLogger {
  override log(message: unknown, ...optionalParams: unknown[]): void {
    const context = optionalParams.at(-1);
    if (typeof context === "string" && STARTUP_CONTEXTS.has(context)) return;
    super.log(message, ...optionalParams);
  }
}
