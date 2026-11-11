# ─── build ───────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY services/api/package.json services/api/
RUN pnpm install --frozen-lockfile --filter @cakeflow/api...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY services/api services/api
RUN pnpm --filter @cakeflow/contracts build \
 && pnpm --filter @cakeflow/api prisma:generate \
 && pnpm --filter @cakeflow/api build

# ─── runtime ─────────────────────────────────────────────────
FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/contracts ./packages/contracts
COPY --from=build /repo/services/api ./services/api
COPY --from=build /repo/pnpm-workspace.yaml /repo/package.json ./
WORKDIR /repo/services/api
EXPOSE 4000
# Run as an unprivileged user. The entrypoint only needs read access.
USER node
CMD ["sh", "./docker-entrypoint.sh"]
