import { BadRequestException, StandardSchemaValidationPipe } from "@nestjs/common";

/**
 * Global pipe that validates any route parameter declared with a schema,
 * e.g. `@Body({ schema: CreatePatientInputSchema })`, using the Zod schemas
 * from @health-mcp/shared. Failures return 400 with the issues in `details`.
 */
export const validationPipe = new StandardSchemaValidationPipe({
  exceptionFactory: (issues) =>
    new BadRequestException({
      error: "Bad Request",
      message: "Validation failed",
      details: issues.map((issue) => ({
        path: (issue.path ?? [])
          .map((segment) => (typeof segment === "object" ? segment.key : segment))
          .join("."),
        message: issue.message,
      })),
    }),
});
