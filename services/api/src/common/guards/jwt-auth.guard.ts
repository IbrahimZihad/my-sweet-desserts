import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { IS_PUBLIC_KEY } from "../decorators/auth.decorators";
import type { AuthenticatedUser } from "../decorators/request.decorators";
import type { RequestWithContext } from "../middleware/request-context.middleware";

interface AccessTokenPayload {
  sub: string;
  bakeryId: string;
  role: "OWNER" | "STAFF";
  sid: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestWithContext & { user?: AuthenticatedUser }>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException({ code: "AUTH_REQUIRED", message: "Sign in required." });

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
      });
    } catch {
      throw new UnauthorizedException({ code: "TOKEN_INVALID", message: "Session expired." });
    }

    // Access tokens are short-lived, but a revoked session must stop working immediately.
    const session = await this.prisma.session.findFirst({
      where: { id: payload.sid, userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        user: {
          select: {
            id: true,
            bakeryId: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
            bakery: {
              select: {
                id: true,
                slug: true,
                name: true,
                timezone: true,
                currency: true,
                customDomain: true,
              },
            },
          },
        },
      },
    });

    if (!session?.user.isActive || session.user.role === UserRole.CUSTOMER) {
      throw new UnauthorizedException({ code: "SESSION_REVOKED", message: "Session is no longer valid." });
    }
    if (session.user.bakeryId !== payload.bakeryId) {
      throw new ForbiddenException({ code: "TENANT_MISMATCH", message: "Tenant mismatch." });
    }

    // The JWT is authoritative for admin requests; the host/header is a hint only.
    req.bakery = session.user.bakery;

    req.user = {
      id: session.user.id,
      bakeryId: session.user.bakeryId,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role as AuthenticatedUser["role"],
      sessionId: payload.sid,
    };
    return true;
  }

  private extractToken(req: RequestWithContext): string | undefined {
    const header = req.header("authorization");
    if (header?.startsWith("Bearer ")) return header.slice(7);
    const cookies = (req as RequestWithContext & { cookies?: Record<string, string> }).cookies;
    return cookies?.["cf_access"];
  }
}
