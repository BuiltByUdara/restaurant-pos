FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY server server
COPY shared shared
RUN npm run build -w server
ENV NODE_ENV=production
USER node
EXPOSE 4000
CMD ["node", "server/dist/index.js"]
