# ── Stage 1: Build React app ──────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json* ./
RUN npm install --silent

# Copy source and build
COPY . .
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

# ── Stage 2: Serve with nginx ──────────────────────────────────
FROM nginx:1.27-alpine

LABEL description="AgentField Support UI — React + nginx"

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# nginx config is mounted via docker-compose volume
# but we also bake in a fallback for standalone runs
COPY nginx-fallback.conf /etc/nginx/conf.d/default.conf

# Copy built React app
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
