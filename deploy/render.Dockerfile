# Official, immutable Memos binary. It is statically linked Go and runs on Node's Alpine image.
FROM neosmemo/memos:26.11.1@sha256:5dcd6e6b973a55b964f2fe2ccdaa33319463ab448a23404ebb5d2acbd19299ba AS memos

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build
WORKDIR /app
COPY package.json index.html ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
ARG MEMORY_SPACE=spaces/together
RUN MEMORY_MODE=live MEMORY_SPACE="$MEMORY_SPACE" node scripts/build.mjs

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata && mkdir -p /var/opt/memos && chown node:node /var/opt/memos
COPY --from=memos /usr/local/memos/memos /usr/local/bin/memos
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY src/domain.js src/memos-provider.js ./src/
COPY deploy/auth-gateway.mjs deploy/hosted-start.mjs deploy/init.mjs ./deploy/
ENV NODE_ENV=production TZ=Asia/Shanghai STATIC_DIR=/app/dist MEMOS_BINARY=/usr/local/bin/memos MEMORY_DATA_DIR=/var/opt/memos
# The supervisor alone starts as root to prepare the mounted volume. Both servers drop to node's UID/GID.
USER root
EXPOSE 10000
CMD ["node", "deploy/hosted-start.mjs"]
