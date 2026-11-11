# CakeFlow Security Model

## 1. Trust boundaries

```
Browser ──(httpOnly cookies, JSON)──▶ Next.js BFF ──(JWT + x-internal-key)──▶ NestJS
                                          │
                                          └── Stripe webhook (signature verified) ──▶ NestJS
```

- The browser is untrusted. Every value is re-validated with Zod on the BFF and
  again in the API.
- The Next.js server is trusted to hold `INTERNAL_API_KEY` and call the API.
- The API container is **not** intended to be publicly routable. Only
  `/v1/payments/webhook` and `/health` are exempt from the BFF key.
- Stripe is authenticated by webhook signature, not by the BFF key.

## 2. Admin authentication

### Passwords

- `scrypt` with a 16-byte random salt and 64-byte derived key, stored as
  `scrypt$salt$hash`. No native build dependency.
- Verification uses `timingSafeEqual`.
- A dummy hash is computed at startup so a missing user and a wrong password
  take comparable time (mitigates account enumeration by timing).
- Minimum password length is enforced at 10 characters by the shared schema.
  Production should add a breached-password check.

### Tokens

| Token | Lifetime | Storage | Contents |
| --- | --- | --- | --- |
| Access JWT | 15 min (configurable) | httpOnly `cf_access` cookie | `sub`, `bakeryId`, `role`, `sid` |
| Refresh token | 30 days | httpOnly `cf_refresh` cookie, path `/api/auth` | `sessionId.randomSecret` |

- Only a SHA-256 hash of the refresh secret is stored in `Session`.
- Refresh is **rotating**: the old session is revoked in the same transaction
  that creates the new one. Reusing an old token fails (`REFRESH_REUSED`).
- The access guard loads the session on every request and rejects revoked or
  expired sessions, so “log out everywhere” is immediate despite the JWT TTL.
- Cookies are `httpOnly`, `SameSite=Lax`, and `Secure` in production.
- The JWT secret and refresh secret are separate 32-byte values. Never reuse
  them, and rotate on a schedule.

### Authorisation

- `JwtAuthGuard` rejects `CUSTOMER` tokens from admin endpoints.
- `RolesGuard` enforces `OWNER` vs `STAFF` per controller.
- `TenantGuard` rejects a JWT whose `bakeryId` does not match the resolved
  tenant. Admin requests take the tenant from the JWT, not the host header.
- Every Prisma query includes `bakeryId`; there is no “find all” helper. The
  `TenantContextService.requireId()` guard makes an unscoped code path fail
  loudly rather than leak across bakeries.

### CSRF

- Mutations are JSON-only (`content-type: application/json`), which blocks
  simple cross-site form posts.
- Cookies are `SameSite=Lax`, so top-level cross-site POSTs do not carry them.
- The BFF and API are same-site in the default deployment. If the API is placed
  on a different registrable domain, add an explicit CSRF token and strict
  `Origin` validation on `/api/*`.
- `GET` endpoints are read-only.

## 3. Tenant isolation

Multi-tenancy is the highest-risk area for a B2B SaaS. Controls:

1. Tenant is resolved server-side from host/header; clients cannot pass a
   `bakeryId` in the booking payload (the schema does not accept it).
2. JWT `bakeryId` is compared to the session user's bakery and the resolved
   tenant.
3. Composite unique keys include `bakeryId`.
4. Admin lookup by reference/id always filters `{ id, bakeryId }`.
5. Public booking lookup requires both `reference` and `email`; a wrong pair
   returns the same 404 as a missing booking (no enumeration).
6. Stripe metadata includes `bakeryId`, and webhook processing verifies it
   against the local payment row.

## 4. Stripe webhook security

- The raw request body is preserved (`NestFactory.create({ rawBody: true })`)
  and verified with `stripe.webhooks.constructEvent`.
- Invalid/missing signatures return `400`; no state changes occur.
- Every event is stored by unique `stripeEventId`. A processing lease prevents
  concurrent duplicate processing; retries are safe.
- Before confirming, the handler verifies amount, currency and order metadata
  against the local `Payment` row. A forged event without the signing secret
  cannot pass.
- Confirmation uses `updateMany({ status: HELD })` so a duplicate or racing
  event cannot double-confirm or double-release capacity.
- A late payment for an expired hold is refunded automatically.
- The Stripe secret key should be a **restricted key** with only the scopes the
  platform needs (PaymentIntents, Refunds, Webhooks read). Never ship it to the
  browser.

## 5. Sensitive customer data

Data minimisation:

- Customers do not have accounts or passwords in Phase 1.
- Orders snapshot name, email, phone and optional notes. Card data never
  touches CakeFlow servers; Stripe Elements posts directly to Stripe.
- Stripe customer IDs are not stored; only PaymentIntent/Charge/Refund IDs.

Recommended production controls:

- MySQL encryption at rest + TLS in transit.
- Encrypt `Order.notes` and phone at the application layer if they may contain
  health/allergy information (special-category data under Australian privacy
  law). At minimum, restrict DB access and backups.
- Redact email/phone/notes from application logs. The API logs order IDs and
  Stripe event IDs, not payloads.
- Retention: purge cancelled/expired orders and their PII after the accounting
  retention period; keep the payment ledger and audit events longer.
- Backups: encrypted, access-controlled, tested restores.
- Do not include customer PII in analytics or error trackers.

## 6. Rate limiting and abuse

- API: global throttler (120 req/min/IP) plus tighter limits on login (5/min)
  and booking creation (10/min). Login is also protected by timing-equalised
  password verification.
- BFF: 5 booking attempts/min/IP/tenant in memory. This is per-instance; use
  Redis/Upstash in production.
- Availability reads are cheap but still limited (120/min).
- Consider adding a CAPTCHA or proof-of-work if deposit spam becomes an issue.

## 7. Headers, CORS and cookies

- API: `helmet`, explicit CORS allowlist from `WEB_ORIGIN`, credentials enabled,
  `trust proxy` set for correct client IPs behind a load balancer.
- Web: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`,
  restrictive `Permissions-Policy`, `poweredByHeader: false`.
- Add a Content-Security-Policy at the reverse proxy/CDN. Stripe Elements
  requires `js.stripe.com`, `api.stripe.com`, and frame sources.
- Admin cookies are scoped to the web origin; the API reads them only when the
  BFF forwards the Authorization header (preferred) or when same-site.

## 8. Secrets and deployment checklist

- [ ] Replace `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `INTERNAL_API_KEY`
      with 32+ byte random values (`openssl rand -base64 48`).
- [ ] Change the seeded owner password; delete or disable demo data.
- [ ] Set `NODE_ENV=production` (enables `Secure` cookies).
- [ ] Terminate TLS at the proxy; redirect HTTP → HTTPS.
- [ ] Keep MySQL private; no public `3306`.
- [ ] Restrict API ingress to the web app, Stripe webhook IPs and health checks.
- [ ] Configure Stripe webhook signing secret; rotate if exposed.
- [ ] Use a Stripe restricted key and separate test/live keys.
- [ ] Enable MySQL backups and test a restore.
- [ ] Add uptime checks for `/health` and alert on 5xx rate.
- [ ] Review logs for PII before enabling a third-party log drain.

## 9. Known MVP gaps

| Gap | Mitigation / next step |
| --- | --- |
| No MFA for bakers | Add TOTP for OWNER accounts |
| No customer email verification | Confirmation link is reference + email; consider signed magic links |
| No field-level PII encryption | Add app-level encryption for notes/phone |
| In-memory rate limit | Move to Redis when scaling beyond one web instance |
| No CSRF token | SameSite + JSON-only today; add token if API is cross-site |
| No automated dependency scanning | Enable Dependabot/Renovate and `pnpm audit` in CI |
| No WAF | Put Cloudflare/Fastly in front of the public endpoints |
