FROM node:22-bookworm-slim AS build
WORKDIR /app
# The desktop build is not part of the server image; skip Electron's binary download.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
EXPOSE 8787
USER node
CMD ["node", "dist-server/index.js"]
