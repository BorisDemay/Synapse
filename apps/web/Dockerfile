# syntax=docker/dockerfile:1.7

FROM node:22.17.0-bookworm AS builder
ARG SYNAPSE_VERSION=0.1.0
ARG SYNAPSE_COMMIT_SHA=development
ENV VITE_SYNAPSE_VERSION=$SYNAPSE_VERSION \
    VITE_SYNAPSE_COMMIT_SHA=$SYNAPSE_COMMIT_SHA
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web ./apps/web
COPY packages ./packages
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @synapse/web build \
  && printf '{"version":"%s","commit_sha":"%s"}\n' "$SYNAPSE_VERSION" "$SYNAPSE_COMMIT_SHA" > apps/web/dist/build.json

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ARG SYNAPSE_VERSION=0.1.0
ARG SYNAPSE_COMMIT_SHA=development
LABEL org.opencontainers.image.version=$SYNAPSE_VERSION \
      org.opencontainers.image.revision=$SYNAPSE_COMMIT_SHA
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /src/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=12 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
