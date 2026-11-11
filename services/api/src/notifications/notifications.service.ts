import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { Prisma } from "@prisma/client";
import { Resend } from "resend";
import { PrismaService } from "../prisma/prisma.service";

type Db = Prisma.TransactionClient;

export interface EmailJob {
  bakeryId: string;
  orderId?: string;
  toEmail: string;
  template: "BOOKING_CONFIRMED" | "BOOKING_CANCELLED" | "BOOKING_EXPIRED" | "BOOKING_PAYMENT_FAILED";
  payload: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const apiKey = this.config.get<string>("RESEND_API_KEY");
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.from = this.config.get<string>("EMAIL_FROM") ?? "CakeFlow <bookings@example.com>";
  }

  /** Enqueue inside the same transaction as the state change (transactional outbox). */
  async enqueue(tx: Db, job: EmailJob): Promise<void> {
    await tx.emailOutbox.create({
      data: {
        bakeryId: job.bakeryId,
        orderId: job.orderId,
        toEmail: job.toEmail,
        template: job.template,
        payload: job.payload as Prisma.InputJsonValue,
      },
    });
  }

  @Cron(CronExpression.EVERY_30_SECONDS, { name: "email-outbox" })
  async processOutbox(): Promise<void> {
    const now = new Date();
    const due = await this.prisma.emailOutbox.findMany({
      where: { status: "PENDING", nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: "asc" },
      take: 20,
    });

    for (const job of due) {
      // Lease the row so a second worker cannot send the same email.
      const claimed = await this.prisma.emailOutbox.updateMany({
        where: { id: job.id, status: "PENDING", nextAttemptAt: { lte: now } },
        data: { nextAttemptAt: new Date(Date.now() + 120_000), attempts: { increment: 1 } },
      });
      if (claimed.count !== 1) continue;

      try {
        if (!this.resend) {
          this.logger.warn(`RESEND_API_KEY missing; marking ${job.id} as sent (dev mode).`);
          await this.markSent(job.id);
          continue;
        }

        const { subject, html } = this.render(job.template, job.payload);
        const { error } = await this.resend.emails.send({
          from: this.from,
          to: job.toEmail,
          subject,
          html,
        });
        if (error) throw new Error(error.message);

        await this.markSent(job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const attempts = job.attempts + 1;
        const failed = attempts >= 5;
        await this.prisma.emailOutbox.update({
          where: { id: job.id },
          data: {
            status: failed ? "FAILED" : "PENDING",
            lastError: message.slice(0, 1000),
            nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts * 30_000, 3_600_000)),
          },
        });
        this.logger.error(`Email ${job.id} attempt ${attempts} failed: ${message}`);
      }
    }
  }

  private async markSent(id: string): Promise<void> {
    await this.prisma.emailOutbox.update({
      where: { id },
      data: { status: "SENT", sentAt: new Date(), lastError: null },
    });
  }

  private render(
    template: EmailJob["template"],
    payload: Record<string, unknown>,
  ): { subject: string; html: string } {
    const bakery = escapeHtml(String(payload.bakeryName ?? "your baker"));
    const reference = escapeHtml(String(payload.reference ?? ""));
    const customer = escapeHtml(String(payload.customerName ?? "there"));
    const cake = escapeHtml(String(payload.cakeName ?? "your cake"));
    const startsAt = payload.startsAt ? new Date(String(payload.startsAt)) : null;
    const timezone = String(payload.timezone ?? "Australia/Melbourne");
    const when = startsAt
      ? new Intl.DateTimeFormat("en-AU", {
          dateStyle: "full",
          timeStyle: "short",
          timeZone: timezone,
        }).format(startsAt)
      : "";
    const money = formatMoney(Number(payload.depositCents ?? 0), String(payload.currency ?? "AUD"));

    const shell = (heading: string, body: string) => `<!doctype html>
<html><body style="font-family:ui-sans-serif,system-ui,sans-serif;background:#faf7f5;padding:32px;color:#2b2320">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">
    <p style="letter-spacing:.12em;text-transform:uppercase;font-size:12px;color:#9b7a86">${bakery}</p>
    <h1 style="font-size:22px;margin:8px 0 16px">${heading}</h1>
    ${body}
    <p style="margin-top:28px;font-size:12px;color:#8a7f7a">Booking reference: <strong>${reference}</strong></p>
  </div>
</body></html>`;

    switch (template) {
      case "BOOKING_CONFIRMED":
        return {
          subject: `Booking confirmed — ${reference}`,
          html: shell(
            `You're booked in, ${customer}!`,
            `<p>Your ${cake} is reserved for <strong>${when}</strong>.</p>
             <p>A deposit of <strong>${money}</strong> has been received. The remaining balance is payable to ${bakery} at pickup.</p>
             <p>Need to change something? Reply to this email or contact ${bakery} directly.</p>`,
          ),
        };
      case "BOOKING_CANCELLED":
        return {
          subject: `Booking cancelled — ${reference}`,
          html: shell(
            "Your booking has been cancelled",
            `<p>Hi ${customer}, your booking for ${cake} on <strong>${when}</strong> has been cancelled.</p>
             <p>If a refund applies, it will appear on your original payment method within 5–10 business days.</p>`,
          ),
        };
      case "BOOKING_EXPIRED":
        return {
          subject: `Booking hold expired — ${reference}`,
          html: shell(
            "Your hold expired",
            `<p>Hi ${customer}, we released your slot because the deposit was not completed in time. You're welcome to book again.</p>`,
          ),
        };
      case "BOOKING_PAYMENT_FAILED":
        return {
          subject: `Payment unsuccessful — ${reference}`,
          html: shell(
            "We couldn't process your deposit",
            `<p>Hi ${customer}, your payment did not go through. Your slot is still held briefly — you can retry from the booking page.</p>`,
          ),
        };
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c]!;
  });
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}
