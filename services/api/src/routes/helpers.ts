import type { Request, RequestHandler, Response } from "express";
import type { ApiRequest, AuthenticatedUser } from "../common/auth";
import { BadRequestException } from "../common/errors";

export type RouteHandler = (req: Request, res: Response) => Promise<unknown> | unknown;

/**
 * Wraps an async handler so rejected promises reach the Express error handler.
 * A returned value is sent as JSON with `status` (default 200); handlers that
 * write the response themselves return `undefined`.
 */
export function route(handler: RouteHandler, status = 200): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res))
      .then((result) => {
        if (result !== undefined && !res.headersSent) res.status(status).json(result);
      })
      .catch(next);
  };
}

export function tenantId(req: Request): string {
  const apiReq = req as ApiRequest;
  const bakeryId = apiReq.user?.bakeryId ?? apiReq.bakery?.id;
  if (!bakeryId) throw new Error("Tenant middleware must run before this handler");
  return bakeryId;
}

export function currentUser(req: Request): AuthenticatedUser {
  const user = (req as ApiRequest).user;
  if (!user) throw new Error("Authentication middleware must run before this handler");
  return user;
}

export function requestId(req: Request): string {
  return (req as ApiRequest).requestId;
}

/** Path params are `string | undefined` under `noUncheckedIndexedAccess`. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: `Missing path parameter: ${name}.`,
    });
  }
  return value;
}
