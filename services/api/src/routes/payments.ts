import { Router } from "express";
import type { ApiRequest, Guards } from "../common/auth";
import { BadRequestException } from "../common/errors";
import type { Services } from "../services";
import { route } from "./helpers";

export function createPaymentsRouter(services: Services, _guards: Guards): Router {
  const router = Router();

  /**
   * Stripe webhook. Signature verification needs the exact bytes, captured by
   * the JSON body parser's `verify` hook. Deliberately skips the BFF key and
   * tenant resolution: Stripe is not a tenant.
   */
  router.post(
    "/payments/webhook",
    route((req) => {
      const rawBody = (req as ApiRequest).rawBody;
      if (!rawBody) {
        throw new BadRequestException({
          code: "RAW_BODY_MISSING",
          message: "Webhook body could not be verified.",
        });
      }
      return services.payments.handleWebhook(rawBody, req.header("stripe-signature"));
    }, 201),
  );

  return router;
}
