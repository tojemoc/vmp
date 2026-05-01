FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/offloading/package*.json ./packages/offloading/
RUN npm ci --workspaces --include-workspace-root
COPY . .
RUN npm run build --workspace=@vmp/offloading
WORKDIR /app/packages/offloading
CMD ["node", "dist/index.js", "demote"]
