# 🔮 Transcription Palantir - Multi-stage Docker Build
# Optimized for production deployment with Bun runtime

# =============================================================================
# BASE STAGE - Common dependencies
# =============================================================================
FROM oven/bun:1-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
    curl \
    ca-certificates \
    tzdata \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# =============================================================================
# DEPENDENCIES STAGE - Install all dependencies
# =============================================================================
FROM base AS dependencies

# Install all dependencies (including dev dependencies)
RUN bun install --frozen-lockfile

# =============================================================================
# BUILD STAGE - Compile TypeScript
# =============================================================================
FROM dependencies AS build

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Build the application
RUN bun run build

# =============================================================================
# PRODUCTION DEPENDENCIES STAGE - Install only production dependencies
# =============================================================================
FROM base AS production-deps

# Install only production dependencies
RUN bun install --frozen-lockfile --production

# =============================================================================
# WHISPER STAGE - Install Whisper.cpp
# =============================================================================
FROM base AS whisper

# Install build dependencies for Whisper.cpp
RUN apk add --no-cache \
    git \
    build-base \
    cmake \
    && rm -rf /var/cache/apk/*

# Clone and build Whisper.cpp
RUN git clone https://github.com/ggerganov/whisper.cpp.git /tmp/whisper.cpp \
    && cd /tmp/whisper.cpp \
    && make \
    && cp main /usr/local/bin/whisper \
    && cp models/download-ggml-model.sh /usr/local/bin/ \
    && chmod +x /usr/local/bin/whisper /usr/local/bin/download-ggml-model.sh

# Download default model
RUN cd /tmp && /usr/local/bin/download-ggml-model.sh small

# =============================================================================
# PRODUCTION STAGE - Final production image
# =============================================================================
FROM base AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs \
    && adduser -S palantir -u 1001

# Copy production dependencies
COPY --from=production-deps /app/node_modules ./node_modules

# Copy built application
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

# Copy Whisper.cpp binary and models
COPY --from=whisper /usr/local/bin/whisper /usr/local/bin/whisper
COPY --from=whisper /tmp/ggml-small.bin /app/models/

# Create necessary directories
RUN mkdir -p /app/audio-input /app/transcripts /app/logs \
    && chown -R palantir:nodejs /app

# Switch to non-root user
USER palantir

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Expose port
EXPOSE 3000

# Default command
CMD ["bun", "run", "start"]

# =============================================================================
# DEVELOPMENT STAGE - Development image with hot reload
# =============================================================================
FROM dependencies AS development

# Install additional development tools
RUN bun add -g nodemon

# Copy source code
COPY . .

# Create directories
RUN mkdir -p /app/audio-input /app/transcripts /app/logs

# Expose port and debug port
EXPOSE 3000 9229

# Development command with hot reload
CMD ["bun", "run", "dev"]
