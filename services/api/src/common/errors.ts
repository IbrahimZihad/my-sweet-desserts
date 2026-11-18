import type { ApiErrorBody } from "@cakeflow/contracts";

/**
 * The single error type thrown by services and middleware.
 *
 * Services were written against NestJS's `HttpException` family; these small
 * classes keep the same call sites (`new ConflictException({ code, message })`)
 * while carrying a plain status code that the Express error handler renders as
 * the `ApiErrorBody` envelope the Next.js BFF already understands.
 */
export interface ApiErrorInit {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, init: ApiErrorInit | string) {
    const normalized: ApiErrorInit = typeof init === "string" ? { code: "HTTP_ERROR", message: init } : init;
    super(normalized.message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = normalized.code;
    this.details = normalized.details;
  }

  toBody(requestId?: string): ApiErrorBody {
    return {
      statusCode: this.statusCode,
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(requestId ? { requestId } : {}),
    };
  }
}

export class BadRequestException extends ApiError {
  constructor(init: ApiErrorInit | string) {
    super(400, init);
  }
}

export class UnauthorizedException extends ApiError {
  constructor(init: ApiErrorInit | string) {
    super(401, init);
  }
}

export class ForbiddenException extends ApiError {
  constructor(init: ApiErrorInit | string) {
    super(403, init);
  }
}

export class NotFoundException extends ApiError {
  constructor(init: ApiErrorInit | string) {
    super(404, init);
  }
}

export class ConflictException extends ApiError {
  constructor(init: ApiErrorInit | string) {
    super(409, init);
  }
}

export class GoneException extends ApiError {
  constructor(init: ApiErrorInit | string) {
    super(410, init);
  }
}

export class PayloadTooLargeException extends ApiError {
  constructor(init: ApiErrorInit | string) {
    super(413, init);
  }
}

export class BadGatewayException extends ApiError {
  constructor(init: ApiErrorInit | string) {
    super(502, init);
  }
}
