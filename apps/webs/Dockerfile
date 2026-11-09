FROM node:24-alpine AS build

WORKDIR /workspace
RUN npm install --global pnpm@10.30.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/webs/package.json apps/webs/package.json
RUN pnpm install --filter @portfolio/webs... --frozen-lockfile

COPY apps/webs apps/webs
RUN pnpm --filter @portfolio/webs build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace

COPY --from=build --chown=node:node /workspace/apps/webs/.output ./.output

USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
