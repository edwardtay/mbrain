FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm install tsx typescript

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build || true

# Expose port (Cloud Run uses PORT env var)
EXPOSE 8080

# Start the server
CMD ["npx", "tsx", "src/index.ts"]
