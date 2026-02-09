FROM node:20-alpine AS build

ARG VITE_STORAGE_MODE=hybrid
ARG VITE_WS_URL=ws://localhost:1234

WORKDIR /app

# Install dependencies first (better layer caching)
COPY ./src/package*.json ./
RUN npm install

# Copy entire source directory including subdirectories
COPY ./src/ .

# Set build-time environment variables
ENV VITE_STORAGE_MODE=${VITE_STORAGE_MODE}
ENV VITE_WS_URL=${VITE_WS_URL}

# Run the build
RUN npm run build

# Production stage - Use Nginx to serve the static files
FROM nginx:stable-alpine

# Copy built files from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
