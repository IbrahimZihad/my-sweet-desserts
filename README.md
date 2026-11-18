# CakeFlow — Melbourne Cake Ordering Platform

CakeFlow is a self-branded booking dashboard for single-baker businesses. Customers
choose a fixed cake, reserve a pickup window, and pay a deposit through Stripe.
The baker gets a dashboard for capacity, deposits and cancellations — without a
marketplace, driver tracking, or a full e-commerce basket.

## Stack

| Layer    | Technology                                                    |
| -------- | ------------------------------------------------------------- |
| Frontend | Next.js 14 App Router, TypeScript, Tailwind CSS               |
| Backend  | NestJS 10 (modular), TypeScript, SQLite                       |
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
│   ├── GDPR.md
│   └── SECURITY.md
└── .env.example
```

## Prerequisites

- Node.js 20.11+
- pnpm 9 (`corepack enable`)

No database server is needed: the API uses SQLite, and Prisma creates the
database file on first migration.

The root `.env` points at a file inside the API's Prisma directory:

```dotenv
DATABASE_URL=file:./dev.db
```

Prisma resolves a relative `file:` URL against the schema directory, so this
lands at `services/api/prisma/dev.db` (git-ignored). Any path works, including
an absolute one such as `file:/tmp/cakeflow/cakeflow.db`.

Delete that file to start from scratch; `pnpm db:migrate` recreates it.

## Setup

```bash
pnpm install
pnpm --filter @cakeflow/contracts build
cp .env.example .env

pnpm db:migrate                 # apply prisma/migrations
pnpm db:seed                    # demo bakery, staff, cakes, slots, booking
pnpm dev                        # API :4000, web :3000
```

Before running the database commands, make sure `DATABASE_URL` in `.env` points
at the SQLite file you want to use:

```dotenv
DATABASE_URL=file:./dev.db
```

Also replace the placeholder application secrets in `.env`. Do not commit this
file.

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

## Privacy and GDPR

The booking flow captures an explicit privacy acknowledgement and, when notes
are supplied, a separate explicit consent for any health/allergy information
(GDPR Art. 9). The policy version, acknowledgement time and consent time are
pinned on the order.

| Surface | Purpose |
| --- | --- |
| `/privacy` | Art. 13/14 notice: controller, purposes, legal bases, recipients, transfers, retention, rights |
| `/cookies` | Cookie table and a control to reopen the consent notice |
| `/privacy/request` | Self-service export (Art. 15/20) and erasure (Art. 17) |
| `/admin/privacy` | Owner-only audit log of data-subject requests |

API endpoints: `POST /v1/privacy/export`, `POST /v1/privacy/erase`,
`GET /v1/admin/privacy/requests` and
`POST /v1/admin/privacy/retention/run`. The nightly retention job anonymises
closed bookings after `Bakery.piiRetentionDays` (default 730), redacts Stripe
webhook payloads and prunes the email queue. Erasure keeps the financial ledger
(amounts, payment IDs, timestamps) but removes name, email, phone and notes.

See [docs/GDPR.md](docs/GDPR.md) for the full data map, request procedure and
launch checklist. Legal review of the published notice and DPAs is still
required.

## Live booking announcements

The admin dashboard includes a speaker panel. Click **Enable announcements**
once per device; the panel then polls
`GET /api/admin/announcements` every 10 seconds and reads each new booking
aloud through the browser's speech synthesis engine at full volume. The
preference is stored locally; no audio leaves the browser and no extra
notification provider is involved. A **Test voice** button checks the selected
voice. Browsers require one user interaction before audio is allowed.

Only the customer's first name is spoken, together with the booking reference,
cake and pickup time, so a speaker in a public area does not broadcast the full
customer record. The API also skips cancelled/expired holds and erased records,
and caps each poll at 25 bookings with a resumable cursor.

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
- Use a managed database with automated backups; the `Payment` and `OrderEvent`
  tables are the financial audit trail.

### Render demo (ephemeral SQLite database, no persistence, no Docker)

`render.yaml` deploys two free web services in Singapore, both on Render's
**native Node runtime** — there is no Docker image involved:

| Service | Runtime | Notes |
| --- | --- | --- |
| `cakeflow-api` | Node 20 | NestJS API backed by a SQLite file in `/tmp` |
| `cakeflow-web` | Node 20 | Next.js storefront + BFF |

SQLite is compiled into Node, so the API build
(`deploy/render/build-api.sh`) is just dependency install, Prisma generate and
`tsc`. The start script (`deploy/render/start-api.sh`) creates
`/tmp/cakeflow/cakeflow.db`, applies the committed migrations, seeds the demo
bakery and runs the API.

The web build (`deploy/render/build-web.sh`) forces `NODE_ENV=production` for
`next build`, because any other value makes Next.js mix its production and
development server runtimes and breaks static prerendering. It also verifies
that the workspace resolves exactly one copy of React
(`deploy/render/check-single-react.cjs`); a cached `node_modules` directory
holding a second React produces the same cryptic prerender crash, so the script
wipes and reinstalls once if that happens.

That means:

- **All data resets on every restart, redeploy or free-tier spin-down.** Each
  boot recreates the database file, applies migrations and re-seeds the demo
  bakery.
- There is no backup and no financial audit trail. Do not take real payments or
  real bookings on this deployment.
- The first request after 15 minutes of inactivity can take a minute or more:
  Render has to boot the instance, then the API migrates and seeds.

To deploy:

1. Push the repository to GitHub/GitLab.
2. In Render, choose **New → Blueprint** and select the repository. Render reads
   `render.yaml`.
3. Set `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and, if you want emails,
   `RESEND_API_KEY`. The API boots with placeholder Stripe secrets; replace
   `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` with test keys if you want the
   payment step to work.
4. If Render appends a suffix to either service name, update
   `API_INTERNAL_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL` and
   `WEB_ORIGIN` to the real `*.onrender.com` URLs.

For anything that must survive a restart, point `DATABASE_URL` at a persistent
volume or a managed database, run `pnpm db:deploy` as a release step, start the
API with `node dist/main.js` and remove the `SEED_ALLOW_PRODUCTION` override. The
demo scripts in `deploy/render/` are not used in that setup.

Demo logins are the seeded ones: `owner@sweetcrumbs.test` / `ChangeMe123!` and
`staff@sweetcrumbs.test` / `StaffPass123!`.

Because the database is ephemeral, the API intentionally runs
`prisma migrate deploy` and the seeder at boot in this mode. That is the one
exception to the "migrations are a release step" rule; persistent deployments
must still run `pnpm db:deploy` before starting the API and must never seed in
production.

