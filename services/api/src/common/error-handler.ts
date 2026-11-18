import { Prisma } from "@prisma/client";
import type { ApiErrorBody } from "@cakeflow/contracts";
import type { ErrorRequestHandler } from "express";
import type { ApiRequest } from "./auth";
import { ApiError } from "./errors";
import { Logger } from "./logger";

const logger = new Logger("http");

/**
 * Renders every failure as the same `ApiErrorBody` envelope the Next.js BFF
 * forwards to the browser. Keeps the Prisma P2002/P2025 mapping the NestJS
 * exception filter used to provide.
 */
export function errorHandler(): ErrorRequestHandler {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const requestId = (req as ApiRequest).requestId;
    let status = 500;
    let body: ApiErrorBody = {
      statusCode: status,
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      requestId,
    };

    if (error instanceof ApiError) {
      status = error.statusCode;
      body = error.toBody(requestId);
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        status = 409;
        body = {
          statusCode: status,
          code: "CONFLICT",
          message: "That record already exists.",
          requestId,
        };
      } else if (error.code === "P2025") {
        status = 404;
        body = { statusCode: status, code: "NOT_FOUND", message: "Record not found.", requestId };
      }
    } else if (isBodyParserError(error)) {
      status = error.status;
      body = {
        statusCode: status,
        code: status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON",
        message:
          status === 413
            ? "Request body is too large."
            : "Request body must be valid JSON.",
        requestId,
      };
    }

    if (status >= 500) {
      logger.error(`${req.method} ${req.originalUrl} -> ${status} [${requestId}]`, error);
    }

    res.status(status).json(body);
  };
}

function isBodyParserError(error: unknown): error is { status: number; type: string } {
  if (!(error instanceof SyntaxError)) return false;
  const candidate = error as SyntaxError & { status?: unknown; type?: unknown };
  return (
    typeof candidate.status === "number" &&
    (candidate.type === "entity.parse.failed" || candidate.type === "entity.too.large")
  );
}
