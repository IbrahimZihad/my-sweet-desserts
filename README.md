# CakeFlow — Melbourne Cake Ordering Platform

CakeFlow is a self-branded booking dashboard for single-baker businesses. Customers
choose a fixed cake, reserve a pickup window, and pay a deposit through Stripe.
The baker gets a dashboard for capacity, deposits and cancellations — without a
marketplace, driver tracking, or a full e-commerce basket.

## Stack

| Layer    | Technology                                                    |
| -------- | ------------------------------------------------------------- |
| Frontend | Next.js 14 App Router, TypeScript, Tailwind CSS               |
| Backend  | NestJS 10 (modular), TypeScript, MySQL 8                      |
| Data     | Prisma ORM, versioned SQL migrations, idempotent seeders      |
| Payments | Stripe PaymentIntents + Connect destination charges + webhooks |
| Email    | Resend, via a transactional outbox table                      |
| Infra    | pnpm workspaces, Node 20                                      |

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
│       │   ├── migrations/           # committed SQL migrations
│       │   ├── seed/                 # modular seeders
│       │   └── seed.ts               # seed entry point
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
└── .env.example
```

## Prerequisites

- Node.js 20.11+
- pnpm 9 (`corepack enable`)
- MySQL 8 running locally

Create the database and application user once:

```sql
CREATE DATABASE cakeflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE cakeflow_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'cakeflow'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON cakeflow.* TO 'cakeflow'@'localhost';
GRANT ALL PRIVILEGES ON cakeflow_shadow.* TO 'cakeflow'@'localhost';
FLUSH PRIVILEGES;
```

`cakeflow_shadow` is only used by `prisma migrate dev` to detect schema drift.
`prisma migrate deploy` (production) never touches it, so the production user
only needs privileges on the application database.

> **MySQL auth plugin:** Prisma supports `caching_sha2_password` (the MySQL 8
> default) and `mysql_native_password`, but not the legacy `sha256_password`.
> If a connection fails with `Unknown authentication plugin`, switch the user:
>
> ```sql
> ALTER USER 'cakeflow'@'localhost' IDENTIFIED WITH caching_sha2_password BY 'change-me';
> -- or, if the server's authentication policy requires it:
> -- ALTER USER 'cakeflow'@'localhost' IDENTIFIED WITH mysql_native_password BY 'change-me';
> FLUSH PRIVILEGES;
> ```

## Setup

```bash
pnpm install
pnpm --filter @cakeflow/contracts build
cp .env.example .env            # set DATABASE_URL and secrets

pnpm db:migrate                 # apply prisma/migrations
pnpm db:seed                    # demo bakery, staff, cakes, slots, booking
pnpm dev                        # API :4000, web :3000
```

Run these from the repository root. The root scripts load `.env` with
`dotenv-cli` and pass it to Prisma and both dev servers; if you invoke a
package-level script directly, export the environment yourself.

- Storefront: http://localhost:3000 (seeded bakery `sweetcrumbs`)
- Admin: http://localhost:3000/admin
- API health: http://localhost:4000/health

Seed credentials (change immediately):

```
owner@sweetcrumbs.test / ChangeMe123!
staff@sweetcrumbs.test / StaffPass123!
```

## Database migrations

Migrations live in `services/api/prisma/migrations/` and are committed as SQL.
The initial migration is `20261111000000_init`; it is an exact diff of
`schema.prisma` (verified with `prisma migrate diff`).

| Command | Purpose |
| --- | --- |
| `pnpm db:migrate` | Create + apply a migration in development (`prisma migrate dev`) |
| `pnpm db:deploy` | Apply committed migrations in staging/production (`prisma migrate deploy`) |
| `pnpm db:status` | Show which migrations have been applied |
| `pnpm db:reset` | Drop, re-migrate and re-seed the local database |
| `pnpm db:seed` | Run the seeders against the current database |
| `pnpm db:studio` | Open Prisma Studio |

Schema change workflow:

1. Edit `services/api/prisma/schema.prisma`.
2. Run `pnpm db:migrate --name <change_name>`.
3. Review the generated SQL and commit it with the schema change.
4. Never edit an applied migration; add a new one instead.

Production deploys must run `pnpm db:deploy` as a release step before the API
starts. The API itself never runs migrations at boot.

## Seeders

`services/api/prisma/seed.ts` is a thin entry point; the work lives in
`services/api/prisma/seed/`:

| File | Seeds |
| --- | --- |
| `bakery.ts` | Demo bakery `sweetcrumbs` + OWNER and STAFF accounts |
| `catalog.ts` | Three fixed-size cakes (upserted, so edits stay authoritative) |
| `slots.ts` | Two pickup windows per day for 21 days, closed Mondays |
| `bookings.ts` | One CONFIRMED demo booking so the dashboard is not empty |

The seed is idempotent and safe to re-run:

- bakery, users and cakes are upserted;
- existing slots are left untouched, so consumed capacity is never reset;
- the demo booking is created once, guarded by a reference check and the same
  conditional capacity update used by the booking API.

Environment overrides:

```
SEED_OWNER_PASSWORD=...     # default ChangeMe123!
SEED_STAFF_PASSWORD=...     # default StaffPass123!
SEED_DEMO_BOOKING=0         # skip the demo booking
SEED_ALLOW_PRODUCTION=1     # required when NODE_ENV=production
```

The seeder refuses to run with `NODE_ENV=production` unless
`SEED_ALLOW_PRODUCTION=1` is set.

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
| `pnpm typecheck` | Typecheck every workspace, including the seeders |
| `pnpm lint` | Lint the API and web app |
| `pnpm db:migrate` | Create + apply a development migration |
| `pnpm db:deploy` | Apply committed migrations |
| `pnpm db:status` | Show applied/pending migrations |
| `pnpm db:seed` | Seed demo data |
| `pnpm db:reset` | Reset the local database and re-seed |
| `pnpm db:studio` | Browse data in Prisma Studio |

## Local Stripe webhooks

```bash
stripe listen --forward-to localhost:4000/v1/payments/webhook
# copy the printed whsec_... into STRIPE_WEBHOOK_SECRET and restart the API
```

## Deployment notes

- **Web → Vercel** is supported. Set `API_INTERNAL_URL`, `INTERNAL_API_KEY`,
  `DEFAULT_BAKERY_SLUG`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- **API → any Node 20 host** (Fly.io, Railway, Render, or a plain VM). Run
  `pnpm db:deploy` in the release step, then start `node dist/main.js`.
- Point Stripe's webhook at `https://api.yourdomain.com/v1/payments/webhook`.
- The API must not be publicly reachable without the BFF key except for the
  webhook and `/health`. Restrict ingress at the proxy if possible.
- Use a managed MySQL with automated backups; the `Payment` and `OrderEvent`
  tables are the financial audit trail.
