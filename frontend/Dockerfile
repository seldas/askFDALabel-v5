FROM node:22-bullseye-slim

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV FRONTEND_PORT=8841
ENV NODE_OPTIONS="--max-old-space-size=2048"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Optimize npm with a BuildKit cache mount
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .

RUN npm run build

EXPOSE 8841

CMD ["npm", "run", "start"]
