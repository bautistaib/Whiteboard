# syntax=docker/dockerfile:1

# ---- Etapa 1: build del frontend -------------------------------------------
FROM node:22-alpine AS web-build
WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- Etapa 2: runtime Python + cloudflared ----------------------------------
FROM python:3.12-slim AS runtime

# cloudflared dentro de la imagen: el DM no corre nada extra
ARG TARGETARCH=amd64
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL -o /usr/local/bin/cloudflared \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${TARGETARCH}" \
 && chmod +x /usr/local/bin/cloudflared \
 && apt-get purge -y curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/pyproject.toml ./
RUN pip install --no-cache-dir .
COPY server/app ./app
COPY --from=web-build /build/dist ./web_dist

ENV DATA_DIR=/data \
    PORT=8000 \
    TUNNEL=on
VOLUME /data
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
