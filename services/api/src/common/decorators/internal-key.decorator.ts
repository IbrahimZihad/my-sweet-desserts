import { SetMetadata } from "@nestjs/common";

export const SKIP_INTERNAL_KEY = "skipInternalKey";

/**
 * Only for endpoints that are called by Stripe or infrastructure — never by
 * the Next.js BFF. Everything else must present the shared BFF key.
 */
export const SkipInternalKey = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_INTERNAL_KEY, true);
