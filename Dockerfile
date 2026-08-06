# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends -y python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Coolify commonly sets NODE_ENV=production for the build. npm would then omit
# devDependencies, but TypeScript is required to compile the application.
RUN npm ci --include=dev

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ARG APP_GIT_SHA=unknown
ENV NODE_ENV=production \
    MCP_HOST=0.0.0.0 \
    PORT=3000 \
    BRAIN_ROOT=/app/brain \
    SESSION_DB_PATH=/app/data/sessions.sqlite \
    APP_GIT_SHA=${APP_GIT_SHA}

RUN mkdir -p /app/data \
    && chown node:node /app/data

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY brain ./brain
COPY knowledge ./knowledge

USER node
EXPOSE 3000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/healthz`).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/index.js"]
