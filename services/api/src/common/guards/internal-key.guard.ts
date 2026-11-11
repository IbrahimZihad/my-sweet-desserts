import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { timingSafeEqual } from "node:crypto";
import { SKIP_INTERNAL_KEY } from "../decorators/internal-key.decorator";
import type { RequestWithContext } from "../middleware/request-context.middleware";

/**
 * Defence in depth: the public API is only meant to be reached through the
 * Next.js BFF. This stops someone from bypassing BFF rate limits/validation by
 * hitting the NestJS container directly. Stripe and health checks are exempt.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_INTERNAL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const req = context.switchToHttp().getRequest<RequestWithContext>();
    const provided = req.header("x-internal-key");
    const expected = this.config.getOrThrow<string>("INTERNAL_API_KEY");

    if (!provided || !safeEqual(provided, expected)) {
      throw new UnauthorizedException({
        code: "BFF_KEY_REQUIRED",
        message: "This API is only available through the CakeFlow frontend.",
      });
    }
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
