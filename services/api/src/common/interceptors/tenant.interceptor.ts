import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { defer, Observable } from "rxjs";
import type { RequestWithContext } from "../middleware/request-context.middleware";
import type { AuthenticatedUser } from "../decorators/request.decorators";
import { TenantContextService } from "../tenant/tenant-context.service";

/**
 * Runs the handler inside an AsyncLocalStorage tenant scope. Using `defer`
 * ensures the scope is active when the Observable is subscribed, not only when
 * it is created.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly tenant: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<RequestWithContext & { user?: AuthenticatedUser }>();
    const bakery = req.bakery;
    const bakeryId = req.user?.bakeryId ?? bakery?.id;

    if (!bakeryId) return next.handle();

    return defer(() =>
      this.tenant.run(
        { bakeryId, slug: bakery?.slug ?? "unknown", requestId: req.requestId },
        () => next.handle(),
      ),
    );
  }
}
