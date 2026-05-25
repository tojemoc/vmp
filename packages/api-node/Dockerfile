FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
COPY packages/api-node/package.json ./packages/api-node/

RUN npm ci --include-workspace-root \
    --workspace=@vmp/shared \
    --workspace=@vmp/api \
    --workspace=@vmp/api-node

COPY packages/shared ./packages/shared
COPY packages/api/src ./packages/api/src
COPY packages/api/migrations ./packages/api/migrations
COPY packages/api-node/src ./packages/api-node/src
COPY packages/api-node/scripts ./packages/api-node/scripts
COPY packages/api-node/tsconfig.json ./packages/api-node/tsconfig.json

RUN npm run build --workspace=@vmp/api-node

RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node

ENV SQLITE_DB_PATH=/data/vmp.sqlite
ENV PORT=8787

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=15s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "packages/api-node/dist/server.js"]
