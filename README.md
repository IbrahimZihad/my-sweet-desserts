# CakeFlow — Melbourne Cake Ordering Platform

CakeFlow is a self-branded booking dashboard for single-baker businesses. Customers
choose a fixed cake, reserve a pickup window, and pay a deposit through Stripe.
The baker gets a dashboard for capacity, deposits and cancellations — without a
marketplace, driver tracking, or a full e-commerce basket.

## Stack

| Layer    | Technology                                                   |
| -------- | ------------------------------------------------------------ |
| Frontend | Next.js 14 App Router, TypeScript, Tailwind CSS              |
| Backend  | NestJS 10 (modular), TypeScript, MySQL 8                     |
| Data     | Prisma ORM (shared schema, `bakeryId` tenant column)         |
| Payments | Stripe PaymentIntents + Connect destination charges + webhooks |
| Email    | Resend, via a transactional outbox table                     |
| Infra    | pnpm workspaces, Docker Compose, Next standalone output      |

## Repository layout

```
.
├── apps/
│   └── web/                          # Next.js 14 storefront + admin + BFF
│       ├── src/app/
│       │   ├── page.tsx              # public gallery
│       │   ├── book/                 # booking wizard
│       │   ├── booking/[reference]/  # confirmation page
│       │   ├── admin/                # login + dashboard (route group)
│       │   └── api/                  # BFF route handlers
│       ├── src/components/
│       ├── src/lib/                  # typed API client, auth, tenant, format
│       └── src/middleware.ts         # cheap admin cookie gate
├── services/
│   └── api/                          # NestJS API
│       ├── prisma/
│       │   ├── schema.prisma         # multi-tenant data model
│       │   ├── migrations/
│       │   └── seed.ts
│       └── src/
│           ├── auth/                 # JWT access + rotating refresh sessions
│           ├── bakeries/             # storefront, settings, cakes, stats
│           ├── bookings/             # holds, cancellation, expiry cron
│           ├── payments/             # Stripe intents, refunds, webhooks
│           ├── slots/                # availability + capacity
│           ├── notifications/        # outbox worker (Resend)
│           ├── common/               # tenant, guards, pipes, filters
│           └── prisma/
├── packages/
│   └── contracts/                    # zod schemas + shared DTOs
├── docs/
│   ├── ARCHITECTURE.md
│   └── SECURITY.md
├── docker-compose.yml
└── .env.example
```

## Quick start (Docker)

```bash
cp .env.example .env
# Fill in JWT secrets, INTERNAL_API_KEY and Stripe keys.
docker compose up --build
```

- Storefront: http://localhost:3000 (seeded bakery `sweetcrumbs`)
- Admin: http://localhost:3000/admin
- API health: http://localhost:4000/health

Seed credentials (change immediately):

```
owner@sweetcrumbs.test / ChangeMe123!
```

Seed runs manually:

```bash
docker compose exec api pnpm prisma:seed
```

For local Stripe webhooks:

```bash
docker compose --profile stripe up stripe
# copy the printed whsec_... into STRIPE_WEBHOOK_SECRET and restart the API
```

## Local development (without Docker)

```bash
pnpm install
pnpm --filter @cakeflow/contracts build
cp .env.example .env               # point DATABASE_URL at local MySQL
pnpm --filter @cakeflow/api prisma:migrate
pnpm --filter @cakeflow/api prisma:seed
pnpm dev
```

The API runs on `:4000`, the web app on `:3000`. Both read the root `.env`
(or `apps/web/.env.local` for the web-only values).

## Booking flow (important)

1. `POST /api/bookings` (Next BFF) validates and forwards to NestJS.
2. NestJS reserves capacity with an atomic conditional `UPDATE` and creates a
   `HELD` order plus a Stripe PaymentIntent.
3. The browser confirms the card with Stripe Elements.
4. Stripe calls `POST /v1/payments/webhook`. Only this signed webhook moves the
   order to `CONFIRMED` and queues the confirmation email.
5. Unpaid holds expire after `Bakery.holdMinutes` and release capacity.
6. A payment that lands after expiry is captured then refunded automatically.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the state machine and
[docs/SECURITY.md](docs/SECURITY.md) for the auth/tenant model.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Build contracts, run API + web in watch mode |
| `pnpm build` | Build contracts, API and web |
| `pnpm typecheck` | Typecheck every workspace |
| `pnpm db:migrate` | `prisma migrate dev` |
| `pnpm db:seed` | Seed demo bakery, cakes and slots |
| `docker compose up --build` | Full local stack |

## Deployment notes

- **Web → Vercel** is supported. Set `API_INTERNAL_URL`, `INTERNAL_API_KEY`,
  `DEFAULT_BAKERY_SLUG`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- **API → any container host** (Fly.io, Railway, ECS, Render). Run
  `prisma migrate deploy` before boot; the Docker entrypoint does this.
- Point Stripe's webhook at `https://api.yourdomain.com/v1/payments/webhook`.
- The API must not be publicly reachable without the BFF key except for the
  webhook and `/health`. Restrict ingress at the proxy if possible.
- Use a managed MySQL with automated backups; the `Payment` and `OrderEvent`
  tables are the financial audit trail.
