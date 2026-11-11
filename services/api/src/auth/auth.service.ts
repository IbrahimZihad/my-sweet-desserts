import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { UserRole } from "@prisma/client";
import type { LoginInput } from "@cakeflow/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async login(
    bakeryId: string,
    input: LoginInput,
    meta: { userAgent?: string; ipAddress?: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { bakeryId_email: { bakeryId, email: input.email } },
    });

    const isStaff = user?.role === UserRole.OWNER || user?.role === UserRole.STAFF;
    const valid = await this.passwords.verify(
      input.password,
      user && isStaff ? user.passwordHash : null,
    );

    if (!user || !valid || !user.isActive || !isStaff) {
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Email or password is incorrect.",
      });
    }

    const tokens = await this.tokens.issue(user, meta);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    return this.tokens.toResponse(user, tokens);
  }

  async refresh(refreshToken: string) {
    const { user, tokens } = await this.tokens.rotate(refreshToken);
    return this.tokens.toResponse(user, tokens);
  }

  async logout(refreshToken?: string, sessionId?: string): Promise<void> {
    if (refreshToken) await this.tokens.revokeByRefreshToken(refreshToken);
    if (sessionId) await this.tokens.revokeSession(sessionId);
  }

  @Cron("0 3 * * *", { name: "prune-sessions" })
  async pruneSessions(): Promise<void> {
    const result = await this.prisma.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: new Date(Date.now() - 7 * 86_400_000) } }] },
    });
    if (result.count) this.logger.log(`Pruned ${result.count} expired sessions`);
  }
}
