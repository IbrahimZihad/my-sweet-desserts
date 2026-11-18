import type { RequestHandler } from "express";
import { ZodError, type ZodTypeAny } from "zod";
import { BadRequestException } from "./errors";

type Source = "body" | "query" | "params";

/**
 * Express replacement for the NestJS `ZodValidationPipe`. Parsed values replace
 * the raw input so route handlers can trust `req.body` / `req.query`.
 */
export function validate(schema: ZodTypeAny, source: Source = "body"): RequestHandler {
  return (req, _res, next) => {
    try {
      const parsed = schema.parse(req[source]) as unknown;
      (req as unknown as Record<string, unknown>)[source] = parsed;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          new BadRequestException({
            code: "VALIDATION_ERROR",
            message: "Request validation failed.",
            details: error.flatten(),
          }),
        );
        return;
      }
      next(error);
    }
  };
}
