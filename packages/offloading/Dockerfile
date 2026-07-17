FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/storage/package*.json ./packages/storage/
COPY packages/offloading/package*.json ./packages/offloading/
RUN npm ci --workspaces --include-workspace-root
COPY . .
# offloading build compiles @vmp/storage first (exports → dist/).
RUN npm run build --workspace=@vmp/offloading
RUN chown -R node:node /app
USER node
WORKDIR /app/packages/offloading
CMD ["node", "dist/index.js", "demote"]
