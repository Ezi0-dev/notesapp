# ============================================
# Multi-Stage Dockerfile for Production-Ready Node.js Backend
# ============================================
# This Dockerfile demonstrates security best practices:
# - Multi-stage builds to minimize final image size
# - Non-root user execution
# - Separate development and production targets
# - Proper signal handling with dumb-init
# - Security updates and minimal attack surface
# ============================================

# ============================================
# Stage 1: Base Image with Security Updates
# ============================================
FROM node:18-alpine AS base

# Install security updates and dumb-init for proper signal handling
# dumb-init ensures proper signal forwarding (SIGTERM, SIGINT) for graceful shutdowns
RUN apk update && \
    apk upgrade && \
    apk add --no-cache dumb-init && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Copy dependency manifests first (layer caching optimization)
COPY package*.json ./

# ============================================
# Stage 2: Development Dependencies
# ============================================
FROM base AS development

# Install ALL dependencies (including devDependencies like nodemon)
RUN npm ci && \
    npm cache clean --force

# Copy source code
COPY . .

# Create logs directory with proper permissions
RUN mkdir -p logs

# Create non-root user for security
# Using specific UID/GID for consistency across environments
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

EXPOSE 5000

# Use dumb-init to handle signals properly (prevents zombie processes)
CMD ["dumb-init", "npm", "run", "dev"]

# ============================================
# Stage 3: Production Dependencies
# ============================================
FROM base AS production-deps

# Install ONLY production dependencies (no devDependencies)
# --only=production flag is deprecated, using --omit=dev instead
RUN npm ci --omit=dev && \
    npm cache clean --force

# ============================================
# Stage 4: Production Build
# ============================================
FROM node:18-alpine AS production

# Install security updates and dumb-init
RUN apk update && \
    apk upgrade && \
    apk add --no-cache dumb-init && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Copy production dependencies from previous stage
COPY --from=production-deps /app/node_modules ./node_modules

# Copy application code (with proper ownership)
COPY --chown=node:node . .

# Create logs directory
RUN mkdir -p logs && \
    chown -R node:node logs

# Use built-in node user (UID 1000)
USER node

EXPOSE 5000

# Health check built into Docker
# Checks if the /health endpoint returns 200 OK
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Production entrypoint with signal handling
CMD ["dumb-init", "node", "src/server.js"]

# ============================================
# Build Instructions
# ============================================
# Development:
#   docker build --target development -t notes-backend:dev .
#   docker run -p 5000:5000 notes-backend:dev
#
# Production:
#   docker build --target production -t notes-backend:prod .
#   docker run -p 5000:5000 notes-backend:prod
#
# Using docker-compose:
#   Set BUILD_TARGET=development in .env for dev
#   Set BUILD_TARGET=production in .env for prod
# ============================================
