import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { RequestWithContext } from "../middleware/request-context.middleware";
import type { UserRole } from "@cakeflow/contracts";

export interface AuthenticatedUser {
  id: string;
  bakeryId: string;
  email: string;
  name: string;
  role: Extract<UserRole, "OWNER" | "STAFF">;
  sessionId: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<RequestWithContext & { user: AuthenticatedUser }>();
    return req.user;
  },
);

export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<RequestWithContext>();
  const bakeryId = req.bakery?.id;
  if (!bakeryId) throw new Error("TenantGuard must run before @TenantId()");
  return bakeryId;
});

export const RequestId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<RequestWithContext>();
  return req.requestId;
});
