FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server
ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787
CMD ["node", "dist-server/index.js"]
