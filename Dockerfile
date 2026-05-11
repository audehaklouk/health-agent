# Dockerfile for EigenCompute TDX deployment
# REQUIREMENTS:
#   - linux/amd64 (Intel TDX is x86)
#   - runs as root (TEE requirement)
#   - EXPOSE the port and listen on 0.0.0.0
#   - DO NOT set ENTRYPOINT — EigenCompute wraps CMD with compute-source-env.sh
#     which fetches sealed secrets at boot and writes them to /tmp/.env

FROM --platform=linux/amd64 node:20-bookworm-slim AS builder
WORKDIR /app

# better-sqlite3 needs build tools; only in builder stage
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* tsconfig.json ./
RUN npm install --no-audit --no-fund

COPY src ./src
COPY public ./public
RUN npm run build \
 && npm prune --production

FROM --platform=linux/amd64 node:20-bookworm-slim
WORKDIR /app

# minimal runtime libs (better-sqlite3 has prebuilt .node, but ensure libstdc++ etc.)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY public ./public
COPY data/personas.json ./data/personas.json

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

# create data dir for encrypted SQLite (TEE provides ephemeral storage by default;
# for persistence across restarts you'll want a mounted volume — see README)
RUN mkdir -p /data

EXPOSE 3000

# IMPORTANT: do NOT set ENTRYPOINT. CMD only.
CMD ["node", "dist/server.js"]
