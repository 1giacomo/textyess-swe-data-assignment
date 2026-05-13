FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY client ./client
COPY server ./server
COPY shared ./shared
RUN pnpm build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --no-frozen-lockfile
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
ENV PORT=3003
EXPOSE 3003
CMD ["node", "dist/server/index.js"]
