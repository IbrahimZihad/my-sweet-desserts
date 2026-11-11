import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public, SkipTenant } from "../common/decorators/auth.decorators";
import { SkipInternalKey } from "../common/decorators/internal-key.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipTenant()
  @SkipInternalKey()
  @SkipThrottle()
  @Get("health")
  async health() {
    const startedAt = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: "ok",
      database: "up",
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    };
  }
}
