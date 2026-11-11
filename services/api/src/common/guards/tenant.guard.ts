import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SKIP_TENANT_KEY } from "../decorators/auth.decorators";
import type { RequestWithContext } from "../middleware/request-context.middleware";
import type { AuthenticatedUser } from "../decorators/request.decorators";

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const req = context.switchToHttp().getRequest<RequestWithContext & { user?: AuthenticatedUser }>();

    if (req.user) {
      if (req.bakery && req.bakery.id !== req.user.bakeryId) {
        throw new ForbiddenException({
          code: "TENANT_MISMATCH",
          message: "You do not have access to this bakery.",
        });
      }
      return true;
    }

    if (!req.bakery) {
      throw new BadRequestException({
        code: "TENANT_REQUIRED",
        message: "A bakery context is required. Provide x-bakery-slug or use a mapped domain.",
      });
    }
    return true;
  }
}
