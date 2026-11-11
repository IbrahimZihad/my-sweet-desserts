import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import type { ApiErrorBody } from "@cakeflow/contracts";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = (req as Request & { requestId?: string }).requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiErrorBody = {
      statusCode: status,
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      requestId,
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === "string") {
        body = { statusCode: status, code: "HTTP_ERROR", message: response, requestId };
      } else {
        const raw = response as Record<string, unknown>;
        body = {
          statusCode: status,
          code: typeof raw.code === "string" ? raw.code : "HTTP_ERROR",
          message:
            typeof raw.message === "string"
              ? raw.message
              : Array.isArray(raw.message)
                ? raw.message.join("; ")
                : "Request failed.",
          details: raw.details,
          requestId,
        };
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2002") {
        status = HttpStatus.CONFLICT;
        body = {
          statusCode: status,
          code: "CONFLICT",
          message: "That record already exists.",
          requestId,
        };
      } else if (exception.code === "P2025") {
        status = HttpStatus.NOT_FOUND;
        body = { statusCode: status, code: "NOT_FOUND", message: "Record not found.", requestId };
      }
    }

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} → ${status} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json(body);
  }
}
