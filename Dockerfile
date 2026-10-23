# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

# Install system build dependencies required for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install npm dependencies first (utilize Docker layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source files
COPY . .

# Ensure storage directories exist
RUN mkdir -p /app/storage/images

# Expose application port
EXPOSE 8086

# Healthcheck to verify the web server is responding
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8086/ || exit 1

# Start the Node.js server
CMD ["node", "server.js"]
