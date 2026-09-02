# syntax=docker/dockerfile:1

# ---- build ------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 compiles a native binding when no prebuilt matches the platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Drop dev-only packages but keep the native binding built above for this platform.
RUN npm prune --omit=dev

# ---- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    INKWELL_DATA_DIR=/data

# node_modules is copied wholesale rather than relying on Next's standalone trace:
# the trace follows only what the app imports, so it omits pdf-lib for the seed
# script and can pick the wrong better-sqlite3 prebuild.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next        ./.next
COPY --from=build /app/public       ./public
COPY --from=build /app/lib          ./lib
COPY --from=build /app/scripts      ./scripts
COPY --from=build /app/package.json /app/next.config.mjs ./

# The database and every stored document live here. Mount a persistent volume at
# /data — without one, all data is lost when the container is replaced.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
USER node

EXPOSE 3000
CMD ["node", "scripts/start.mjs"]
