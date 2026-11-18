import type { AppConfig } from "./config/env";
import { AuthService } from "./auth/auth.service";
import { PasswordService } from "./auth/password.service";
import { TokenService } from "./auth/token.service";
import { BookingsService } from "./bookings/bookings.service";
import { NotificationsService } from "./notifications/notifications.service";
import { PaymentsService } from "./payments/payments.service";
import { PrivacyService } from "./privacy/privacy.service";
import { SlotsService } from "./slots/slots.service";
import type { PrismaService } from "./prisma/prisma.service";

export interface Services {
  auth: AuthService;
  bookings: BookingsService;
  notifications: NotificationsService;
  payments: PaymentsService;
  privacy: PrivacyService;
  slots: SlotsService;
}

/**
 * Hand-rolled composition root. Replaces the NestJS DI container: construction
 * order is explicit and there are no decorators or reflection at runtime.
 */
export function createServices(config: AppConfig, prisma: PrismaService): Services {
  const passwords = new PasswordService();
  const tokens = new TokenService(config, prisma);
  const auth = new AuthService(prisma, passwords, tokens);
  const notifications = new NotificationsService(prisma, config);
  const payments = new PaymentsService(config, prisma);
  const bookings = new BookingsService(prisma, payments, notifications);
  const slots = new SlotsService(prisma);
  const privacy = new PrivacyService(prisma, config);

  return { auth, bookings, notifications, payments, privacy, slots };
}
