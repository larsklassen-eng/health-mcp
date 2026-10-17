import type { ApiError } from "@health-mcp/shared";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

/** Turns every error into the shared {@link ApiError} body, and hides internals of unexpected errors. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        exception instanceof Error ? (exception.stack ?? exception.message) : exception,
      );
      const body: ApiError = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: "Internal Server Error",
        message: "Something went wrong",
      };
      response.status(body.statusCode).json(body);
      return;
    }

    const statusCode = exception.getStatus();
    const raw = exception.getResponse();
    const fields = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const body: ApiError = {
      statusCode,
      error: typeof fields.error === "string" ? fields.error : exception.name,
      message: typeof fields.message === "string" ? fields.message : exception.message,
      ...(fields.details !== undefined && { details: fields.details }),
    };
    response.status(statusCode).json(body);
  }
}
