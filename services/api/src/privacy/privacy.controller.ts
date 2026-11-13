import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import {
  privacyErasureSchema,
  privacyRequestSchema,
  type PrivacyErasureInput,
  type PrivacyRequestInput,
} from "@cakeflow/contracts";
import { Public, Roles } from "../common/decorators/auth.decorators";
import { TenantId } from "../common/decorators/request.decorators";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PrivacyService } from "./privacy.service";

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Public data-subject request endpoints. The customer proves control of the
 * booking with the same `reference + email` pair used by the booking lookup.
 */
@Controller("privacy")
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("export")
  export(
    @TenantId() bakeryId: string,
    @Body(new ZodValidationPipe(privacyRequestSchema)) body: PrivacyRequestInput,
  ) {
    return this.privacy.exportData(bakeryId, body);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("erase")
  erase(
    @TenantId() bakeryId: string,
    @Body(new ZodValidationPipe(privacyErasureSchema)) body: PrivacyErasureInput,
  ) {
    return this.privacy.eraseData(bakeryId, body);
  }
}

@Roles("OWNER")
@Controller("admin/privacy")
export class AdminPrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get("requests")
  list(
    @TenantId() bakeryId: string,
    @Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>,
  ) {
    return this.privacy.listRequests(bakeryId, query.page, query.pageSize);
  }

  @Post("retention/run")
  retention(@TenantId() bakeryId: string) {
    return this.privacy.runRetention(bakeryId);
  }
}
