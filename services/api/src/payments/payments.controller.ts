import { BadRequestException, Controller, Headers, Post, RawBodyRequest, Req } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { Public, SkipTenant } from "../common/decorators/auth.decorators";
import { PaymentsService } from "./payments.service";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Stripe webhook. Signature verification uses the raw body, so main.ts must
   * create the app with `{ rawBody: true }`.
   */
  @Public()
  @SkipTenant()
  @SkipThrottle()
  @Post("webhook")
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers("stripe-signature") signature?: string,
  ) {
    if (!req.rawBody) {
      throw new BadRequestException({
        code: "RAW_BODY_MISSING",
        message: "Webhook body could not be verified.",
      });
    }
    return this.payments.handleWebhook(req.rawBody, signature);
  }
}
