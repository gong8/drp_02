# Build context is the repo ROOT (pnpm workspace):
#   docker build -f apps/api/Dockerfile -t bethere-api .
FROM node:20-bookworm-slim

RUN corepack enable
WORKDIR /app

# AWS RDS CA bundle, so the API verifies TLS to RDS (see db/client.ts DATABASE_CA_PATH).
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem

# Manifests first for cached installs. All workspace package.jsons must be present so
# pnpm can validate the lockfile; --filter then installs only the API and its deps.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile --filter @bethere/api...

# Source (shared is consumed as TS; the API runs via tsx).
COPY packages/shared packages/shared
COPY apps/api apps/api

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_CA_PATH=/app/rds-ca.pem
ENV SEED_ON_BOOT=if-empty
EXPOSE 3000

WORKDIR /app/apps/api
CMD ["pnpm", "start"]
