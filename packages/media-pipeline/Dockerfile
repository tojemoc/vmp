FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/media-pipeline/package*.json ./packages/media-pipeline/
RUN npm ci --workspaces --include-workspace-root
COPY . .
RUN npm run build --workspace=@vmp/media-pipeline
RUN groupadd -r app && useradd -r -g app app
RUN chown -R app:app /app
USER app
WORKDIR /app/packages/media-pipeline
CMD ["node", "dist/supervisor.js"]
