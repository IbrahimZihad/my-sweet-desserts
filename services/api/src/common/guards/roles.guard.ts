import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserRole } from "@cakeflow/contracts";
import { ROLES_KEY } from "../decorators/auth.decorators";
import type { AuthenticatedUser } from "../decorators/request.decorators";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Array<Extract<UserRole, "OWNER" | "STAFF">>>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length) return true;

    const req = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ForbiddenException({
        code: "INSUFFICIENT_ROLE",
        message: "Your role cannot perform this action.",
      });
    }
    return true;
  }
}
