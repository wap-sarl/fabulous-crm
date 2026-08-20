# Production image: builds the SPA, then serves it with Caddy.
# The Convex backend is cloud-hosted and deployed separately
# (`bunx convex deploy`); this image only ships the frontend.
#
# Runtime configuration is injected at container start: the entrypoint
# generates /srv/env.js (window.__ENV__) from all VITE_* environment
# variables, so one image works across environments without rebuilding.
# Required at runtime: VITE_CONVEX_URL. Optional: VITE_GOOGLE_MAPS_API_KEY.

ARG BUN_VERSION=1.3.9

FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM caddy:2-alpine
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
COPY --from=build /app/dist /srv
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
