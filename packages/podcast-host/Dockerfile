FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/podcast-host/package*.json ./packages/podcast-host/
RUN npm ci --workspaces --include-workspace-root
COPY . .
RUN npm run build --workspace=@vmp/podcast-host
RUN groupadd -r app && useradd -r -g app app
RUN chown -R app:app /app
USER app
WORKDIR /app/packages/podcast-host
CMD ["node", "dist/supervisor.js"]
