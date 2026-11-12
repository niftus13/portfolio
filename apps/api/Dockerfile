FROM node:24-alpine AS build

WORKDIR /workspace
RUN npm install --global pnpm@10.30.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/webs/package.json apps/webs/package.json
RUN pnpm install --filter @portfolio/api... --frozen-lockfile

COPY apps/api apps/api
COPY tsconfig.json tsconfig.json
RUN pnpm --filter @portfolio/api build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace

COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /workspace/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /workspace/apps/api/migrations ./apps/api/migrations

RUN mkdir -p /workspace/logs && chown node:node /workspace/logs
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
