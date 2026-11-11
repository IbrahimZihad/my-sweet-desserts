import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { BakeriesModule } from "./bakeries/bakeries.module";
import { BookingsModule } from "./bookings/bookings.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { InternalKeyGuard } from "./common/guards/internal-key.guard";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { TenantGuard } from "./common/guards/tenant.guard";
import { TenantInterceptor } from "./common/interceptors/tenant.interceptor";
import { RequestContextMiddleware } from "./common/middleware/request-context.middleware";
import { TenantModule } from "./common/tenant/tenant.module";
import { validateEnv } from "./config/env";
import { HealthController } from "./health/health.controller";
import { NotificationsModule } from "./notifications/notifications.module";
import { PaymentsModule } from "./payments/payments.module";
import { PrismaModule } from "./prisma/prisma.module";
import { SlotsModule } from "./slots/slots.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 120 }]),
    PrismaModule,
    TenantModule,
    AuthModule,
    BakeriesModule,
    SlotsModule,
    BookingsModule,
    PaymentsModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: authenticate → resolve tenant → authorise role.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: InternalKeyGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: "*", method: RequestMethod.ALL });
  }
}
