import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma, User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { LoginResponse } from "@cakeflow/contracts";

const REFRESH_PREFIX = "cfr_";

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async issue(
    user: Pick<User, "id" | "bakeryId" | "role">,
    meta: { userAgent?: string; ipAddress?: string },
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<IssuedTokens> {
    const accessTtl = this.parseDuration(this.config.getOrThrow<string>("JWT_ACCESS_TTL"));
    const refreshTtl = this.parseDuration(this.config.getOrThrow<string>("JWT_REFRESH_TTL"));

    const secret = randomBytes(48).toString("base64url");
    const session = await db.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: this.hash(secret),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
        userAgent: meta.userAgent?.slice(0, 500),
        ipAddress: meta.ipAddress?.slice(0, 60),
      },
      select: { id: true },
    });

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        bakeryId: user.bakeryId,
        role: user.role,
        sid: session.id,
      },
      {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        expiresIn: accessTtl,
      },
    );

    return {
      accessToken,
      refreshToken: `${session.id}.${secret}`,
      expiresIn: accessTtl,
      sessionId: session.id,
    };
  }

  /**
   * Rotating refresh: the presented token is revoked and a new session is
   * created. Re-use of an old token fails because its hash no longer resolves.
   */
  async rotate(refreshToken: string): Promise<{ user: User; tokens: IssuedTokens }> {
    const [sessionId, secret] = refreshToken.split(".");
    if (!sessionId || !secret) {
      throw new UnauthorizedException({ code: "REFRESH_INVALID", message: "Invalid refresh token." });
    }

    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        refreshTokenHash: this.hash(secret),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!session?.user.isActive) {
      throw new UnauthorizedException({ code: "REFRESH_INVALID", message: "Session expired." });
    }

    const tokens = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.session.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // Two clients racing the same refresh token: exactly one wins.
      if (revoked.count !== 1) {
        throw new UnauthorizedException({ code: "REFRESH_REUSED", message: "Session already rotated." });
      }
      return this.issue(
        session.user,
        {
          userAgent: session.userAgent ?? undefined,
          ipAddress: session.ipAddress ?? undefined,
        },
        tx,
      );
    });

    return { user: session.user, tokens };
  }

  async revokeByRefreshToken(refreshToken: string): Promise<void> {
    const [sessionId, secret] = refreshToken.split(".");
    if (!sessionId || !secret) return;
    await this.prisma.session.updateMany({
      where: { id: sessionId, refreshTokenHash: this.hash(secret), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  toResponse(user: User, tokens: IssuedTokens): LoginResponse {
    return {
      user: {
        id: user.id,
        bakeryId: user.bakeryId,
        email: user.email,
        name: user.name,
        role: user.role as LoginResponse["user"]["role"],
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  /** Supports `15m`, `30d`, `12h`, `900s`, or a plain number of seconds. */
  private parseDuration(value: string): number {
    if (/^\d+$/.test(value)) return Number(value);
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) throw new Error(`Invalid duration: ${value}`);
    const amount = Number(match[1]);
    const unit = match[2] as "s" | "m" | "h" | "d";
    return amount * { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  }
}
