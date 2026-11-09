# Replicator: Node 22 sin dependencias externas (SQLite viene incluido en Node: node:sqlite).
# La imagen node:22-alpine es multi-arquitectura: el mismo Dockerfile sirve para aarch64 y amd64.
FROM node:22-alpine

# tzdata: para que "hoy" y la hora de los avisos usen la zona horaria de Home Assistant (TZ la pasa el Supervisor).
RUN apk add --no-cache tzdata

ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    HOST=0.0.0.0 \
    PORT=8099 \
    DATA_DIR=/data \
    WEB_DIR=/app/web

COPY app/ /app/
WORKDIR /app/api

CMD ["node", "server.js"]
