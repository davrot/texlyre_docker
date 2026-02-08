FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application files
COPY *.js ./

# Create logs directory
RUN mkdir -p logs

EXPOSE 1234

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:1234', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

CMD ["node", "index.js"]
