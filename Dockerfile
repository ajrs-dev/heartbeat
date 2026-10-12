# syntax=docker/dockerfile:1

# ---------- build: compile the server and bundle the web app ----------
FROM node:24-slim AS build
WORKDIR /app

# Copy manifests first so the dependency layer is cached until they change.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY server server
COPY web web
RUN npm run build

# ---------- deps: production dependencies only (no TypeScript, Vite, test tools) ----------
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server

# ---------- runtime ----------
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/data/heartbeat.db
WORKDIR /app

COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/dist server/dist
# The server looks for the built UI at ../../web/dist relative to server/dist.
COPY --from=build /app/web/dist web/dist

# SQLite lives on a volume so data survives container restarts. Run as the unprivileged
# "node" user that ships with the base image.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
