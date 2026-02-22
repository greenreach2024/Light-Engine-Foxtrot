# ── Build stage ────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN npm run build

# ── Production stage ──────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output + migrations + seeds + static assets
COPY --from=build /app/dist/ ./dist/
COPY src/db/ ./src/db/
COPY scripts/ ./scripts/
COPY public/ ./public/

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
