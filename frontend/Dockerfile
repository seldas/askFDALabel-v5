FROM node:22-bullseye-slim

ARG BUILD_ENV=production
ENV NODE_ENV=${BUILD_ENV}
ENV HOST=0.0.0.0
ENV FRONTEND_PORT=8841
ENV NODE_OPTIONS="--max-old-space-size=2048"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies (cached by BuildKit when package*.json is unchanged)
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy source and build only in production mode.
# In dev mode the source is provided by a bind mount at runtime, so
# running `npm run build` here would be both slow and immediately discarded.
COPY . .
RUN if [ "$BUILD_ENV" = "production" ]; then npm run build; fi

EXPOSE 8841

CMD ["npm", "run", "start"]
