import { Body, Controller, Get, Ip, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { loginSchema, refreshSchema, type LoginInput } from "@cakeflow/contracts";
import type { Request } from "express";
import { Public, SkipTenant } from "../common/decorators/auth.decorators";
import { CurrentUser, TenantId, type AuthenticatedUser } from "../common/decorators/request.decorators";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login")
  async login(
    @TenantId() bakeryId: string,
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.auth.login(bakeryId, body, {
      userAgent: req.header("user-agent"),
      ipAddress: ip,
    });
  }

  @Public()
  @SkipTenant()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("refresh")
  async refresh(@Body(new ZodValidationPipe(refreshSchema)) body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @SkipTenant()
  @Post("logout")
  async logout(@Body() body: { refreshToken?: string }) {
    await this.auth.logout(body?.refreshToken);
    return { ok: true };
  }

  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return {
      id: user.id,
      bakeryId: user.bakeryId,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }
}
