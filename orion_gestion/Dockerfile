# Orion Gestión: puente liviano entre Home Assistant y el sistema de gestión web del cliente.
# Node 22 sin dependencias externas. La imagen node:22-alpine es multi-arquitectura (aarch64 y amd64).
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8099 \
    DATA_DIR=/data

COPY app/ /app/
WORKDIR /app

CMD ["node", "server.js"]
