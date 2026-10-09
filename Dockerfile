FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests
COPY migrations ./migrations
RUN npm run build
CMD ["npm", "start"]
