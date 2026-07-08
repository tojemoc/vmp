FROM node:22-bookworm-slim

# Runtime tools: watchfolder (inotifywait) and podcast MP3 rendering (ffmpeg).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    inotify-tools \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/storage/package*.json ./packages/storage/
COPY packages/media-pipeline/package*.json ./packages/media-pipeline/
RUN npm ci --workspaces --include-workspace-root
COPY . .
RUN npm run build --workspace=@vmp/media-pipeline
RUN npm prune --omit=dev --workspaces --include-workspace-root
ENV NODE_ENV=production
RUN groupadd -r app && useradd -r -g app app
RUN chown -R app:app /app
USER app
WORKDIR /app/packages/media-pipeline
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8788/health || exit 1
CMD ["node", "dist/supervisor.js"]
