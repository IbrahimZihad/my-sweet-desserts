# CakeFlow Architecture

## 1. System context

```
                    ┌──────────────────────────────┐
  Customer ────────▶│ Next.js (apps/web)           │
  (public)           │  · storefront + booking UI   │
                    │  · admin dashboard           │
                    │  · BFF route handlers        │
                    └──────────┬───────────────────┘
                               │ HTTPS + x-internal-key
                               │ x-bakery-slug, JWT
                    ┌──────────▼───────────────────┐
                    │ NestJS API (services/api)    │
                    │  auth · bookings · payments  │
                    │  slots · notifications       │
                    └───┬───────────┬──────────┬───┘
                        │           │          │
                   ┌────▼────┐  ┌───▼────┐  ┌──▼─────────┐
                   │ MySQL 8 │  │ Stripe │  │ Resend     │
                   │ Prisma  │  │ Connect│  │ (outbox)   │
                   └─────────┘  └────────┘  └────────────┘
```

The browser never talks to the API service directly. Next.js is both the UI
and the backend-for-frontend (BFF): it validates input, rate limits, resolves the
tenant, and forwards authenticated requests with the shared BFF key.

## 2. Multi-tenancy

**Model:** shared MySQL schema, tenant discriminator `bakeryId` on every
tenant-owned table. This keeps one deployment able to host a small number of
bakeries, while the product constraint “one baker = one instance” still holds at
the storefront level (one branded site per tenant).

**Tenant resolution (in order):**

1. `x-bakery-slug` header set by the Next.js BFF (never trusted for authz).
2. Exact `Bakery.customDomain` match.
3. Subdomain label, e.g. `sweetcrumbs.cakeflow.app`.
4. `DEFAULT_BAKERY_SLUG` for local development only.

**Enforcement layers:**

| Layer | Mechanism |
| --- | --- |
| Request | `RequestContextMiddleware` resolves `req.bakery` |
| Auth | JWT contains `bakeryId`; `JwtAuthGuard` verifies the session's user still belongs to it |
| Tenant | `TenantGuard` rejects mismatches between host/header tenant and JWT tenant |
| Service | Every query passes an explicit `bakeryId`; `TenantContextService.requireId()` exists for code paths that must not run without a tenant |
| Database | Composite uniques (`[bakeryId, slug]`, `[bakeryId, email]`, `[bakeryId, startsAt]`) prevent cross-tenant collisions |

Admin requests are authoritative from the JWT: `JwtAuthGuard` overwrites the
host-derived bakery with the user's bakery. Public requests are authoritative
from the resolved tenant, and no client-supplied `bakeryId` is accepted.

## 3. Data model

| Table | Purpose | Key invariants |
| --- | --- | --- |
| `Bakery` | Tenant, branding, deposit policy, Stripe account | `slug`, `customDomain`, `stripeAccountId` unique |
| `User` | Staff (`OWNER`/`STAFF`) and per-tenant customers | unique `[bakeryId, email]`; staff have a password hash |
| `Session` | Refresh-token sessions | hashed refresh token, revocable, expiring |
| `Cake` | Fixed SKU: flavour + size + price | no modifier tables by design |
| `Slot` | Pickup window with capacity | unique `[bakeryId, startsAt]`, `bookedCount <= capacity` enforced in SQL |
| `Order` | Booking/appointment + deposit snapshot | `[bakeryId, idempotencyKey]` unique, immutable customer snapshot |
| `Payment` | Deposit/refund ledger | one row per intent, Stripe IDs unique |
| `StripeEvent` | Webhook idempotency + processing lease | `stripeEventId` unique |
| `OrderEvent` | Append-only audit trail | who/what/when for every transition |
| `EmailOutbox` | Transactional outbox for Resend | retries with exponential backoff |

Money is stored in integer cents. Currency is captured on the order so a later
bakery currency change cannot rewrite history. Customer name/email/phone are
snapshotted onto the order because the `User` profile is mutable.

### Migrations and seeders

- Schema changes are made in `prisma/schema.prisma` and captured as committed SQL
  in `prisma/migrations/` (`pnpm db:migrate --name <change>`).
- `pnpm db:deploy` applies pending migrations in staging/production as a release
  step; the API never migrates at boot.
- `prisma/seed/` holds idempotent development seeders (bakery, staff, catalog,
  slots, demo booking). Re-running never resets consumed slot capacity and never
  duplicates the demo booking.
- The seeder refuses `NODE_ENV=production` unless `SEED_ALLOW_PRODUCTION=1`.

## 4. Booking state machine

```
                 create booking (slot reserved)
                             │
                             ▼
                          ┌──────┐   hold expires    ┌─────────┐
                          │ HELD │ ─────────────────▶│ EXPIRED │
                          └──┬───┘                   └─────────┘
                             │ payment_intent.succeeded
                             ▼
                       ┌───────────┐  cancel (customer/baker)  ┌───────────┐
                       │ CONFIRMED │ ────────────────────────▶ │ CANCELLED │
                       └─────┬─────┘                          └───────────┘
                             │ pickup done
                             ▼
                       ┌───────────┐
                       │ COMPLETED │
                       └───────────┘
```

- `HELD` and `PENDING_PAYMENT` consume capacity.
- `CONFIRMED` is **only** reachable from a verified Stripe webhook.
- `EXPIRED` releases capacity; a late successful payment is refunded.
- Cancellation releases capacity and refunds only when the policy allows it.

`PaymentStatus` is a separate axis (`REQUIRES_PAYMENT → SUCCEEDED → REFUNDED`)
so an order can be cancelled without losing the financial record.

## 5. Overbooking prevention

Capacity is reserved with one conditional SQL statement inside the booking
transaction:

```sql
UPDATE Slot
   SET bookedCount = bookedCount + 1,
       updatedAt = UTC_TIMESTAMP(3)
 WHERE id = ?
   AND bakeryId = ?
   AND status = 'OPEN'
   AND bookedCount < capacity;
```

If the affected-row count is not `1`, the transaction aborts with `SLOT_FULL`.
There is no read-then-write window, so two simultaneous customers cannot both
take the last slot. Cancellation and expiry use:

```sql
UPDATE Slot
   SET bookedCount = GREATEST(bookedCount - 1, 0)
 WHERE id = ? AND bakeryId = ?;
```

Additional protections:

- **Idempotency:** `Order[bakeryId, idempotencyKey]` unique; retries return the
  existing order and re-fetch the PaymentIntent client secret.
- **Hold TTL:** `holdExpiresAt = now + bakery.holdMinutes`; a cron releases
  unpaid holds every minute. The webhook and cron race is resolved by an atomic
  `updateMany` status transition (only one wins).
- **Capacity edits:** lowering capacity below `bookedCount` is rejected with
  `CAPACITY_BELOW_BOOKINGS`.

## 6. Payments (Stripe Connect)

- **Destination charges:** the deposit is charged on the platform and
  transferred to the baker's connected account. An optional platform fee is
  taken as `application_fee_amount` (basis points, default 0).
- **No booking confirmation on the client:** `stripe.confirmPayment()` only
  confirms the card. The server confirms the booking when
  `payment_intent.succeeded` arrives with a valid signature.
- **Validation:** the webhook checks amount, currency, `metadata.orderId` and
  `metadata.bakeryId` against the local `Payment` row before confirming.
- **Idempotency:** `StripeEvent` stores each event ID with a 5-minute processing
  lease; retries are safe. Booking confirmation uses a conditional status
  transition, so a duplicate success is a no-op.
- **Refunds:** refundable deposits are refunded with
  `refunds.create({ reverse_transfer: true })`, using the payment row ID as the
  Stripe idempotency key. Refunds are only attempted after the policy check:
  `depositRefundable && now <= slot.startsAt - refundWindowHours`.
- **Late payment:** if the hold expired before the webhook, the money is
  captured and immediately refunded; an unbooked deposit is never retained.

## 7. API modules and endpoints

| Module | Responsibility |
| --- | --- |
| `AuthModule` | Password verification (scrypt), access JWT, rotating refresh sessions |
| `BakeriesModule` | Public storefront, admin settings, cake CRUD, dashboard stats |
| `SlotsModule` | Public availability, admin slot generation, capacity updates |
| `BookingsModule` | Hold creation, idempotency, customer lookup, cancellation, expiry cron |
| `PaymentsModule` | PaymentIntents, refunds, signed webhook processing |
| `NotificationsModule` | Outbox worker, Resend templates, retry/backoff |
| `PrismaModule` / `TenantModule` | DB client, AsyncLocalStorage tenant carrier |

Public endpoints (BFF key required):

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/v1/storefront` | bakery + active cakes |
| `GET` | `/v1/slots?from&to&cakeId` | availability, lead-time filtered |
| `POST` | `/v1/bookings` | requires `Idempotency-Key` |
| `GET` | `/v1/bookings/:reference?email=` | customer lookup |
| `POST` | `/v1/bookings/:reference/cancel` | customer cancellation |

Admin endpoints (JWT + role):

| Method | Path | Role |
| --- | --- | --- |
| `POST` | `/v1/auth/login` | public |
| `POST` | `/v1/auth/refresh` | public (rotating token) |
| `GET` | `/v1/auth/me` | staff |
| `GET/PATCH` | `/v1/admin/bakery` | OWNER |
| `GET/POST/PATCH` | `/v1/admin/bakery/cakes` | OWNER |
| `GET/POST/PATCH` | `/v1/admin/slots` | OWNER |
| `GET` | `/v1/admin/bookings` | OWNER, STAFF |
| `POST` | `/v1/admin/bookings/:id/cancel` | OWNER, STAFF |
| `GET` | `/v1/admin/stats` | OWNER, STAFF |
| `POST` | `/v1/payments/webhook` | Stripe only (signature, no BFF key) |

## 8. Frontend/BFF

- **Server components** fetch through `apiFetch` with `API_INTERNAL_URL` and the
  BFF key. No API URL is exposed to the browser for data calls.
- **Route handlers** (`/api/bookings`, `/api/availability`, `/api/auth/*`,
  `/api/admin/*`) are the only browser-facing mutation surface. They validate
  with the shared Zod contracts, rate limit, and translate API errors into the
  same `ApiErrorBody` shape.
- **Booking wizard** uses Stripe Elements with a PaymentIntent client secret.
  It polls the booking lookup endpoint after payment because confirmation is
  webhook-driven.
- **Admin session:** access + refresh tokens live in httpOnly cookies. The
  browser never sees the JWT; `SessionKeeper` rotates the refresh token every
  10 minutes while the dashboard is open.
- **Tenant UI:** `DEFAULT_BAKERY_SLUG`/subdomain resolution is centralised in
  `lib/tenant.ts`; the API still validates every request.

## 9. Email delivery

Emails are written to `EmailOutbox` in the **same transaction** as the order
transition. A cron worker leases rows (`nextAttemptAt`), renders a template, and
sends through Resend. Failures retry with exponential backoff (max 5 attempts)
and are visible in `lastError`. This avoids the classic “booking confirmed but
email lost” failure and survives a Resend outage.

## 10. Deployment topology

```
Vercel (Next) ──▶ API on a Node 20 host (private) ──▶ MySQL (managed)
                          │
                          ├──▶ Stripe webhooks
                          └──▶ Resend
```

- The release step runs `pnpm db:deploy` before the API process starts.
- The API has `/health` outside the `/v1` prefix for load balancer checks.
- Stripe webhook URL: `https://api.<domain>/v1/payments/webhook`.
- Keep the API behind a proxy/firewall that only allows the web app, Stripe
  webhook IPs and health checks.

## 11. Deliberate MVP trade-offs

| Decision | Reason |
| --- | --- |
| No customer accounts | Email + reference is enough for lookup/cancel; less PII and auth surface |
| No basket / modifiers | Cakes are single SKUs; slots are appointments |
| One `Slot` row per window | Simple capacity math and auditable per-window pricing |
| Shared DB tenancy | Cheaper than schema-per-tenant; every query is explicitly scoped |
| In-memory BFF rate limit | Single-instance MVP; replace with Redis when horizontally scaled |
| No live tracking | Pickup-only avoids fragile-goods logistics |

Phase 2 candidates: customer magic-link accounts, SMS reminders, baker-level
Stripe onboarding links, calendar export, and Redis-backed rate limiting.
