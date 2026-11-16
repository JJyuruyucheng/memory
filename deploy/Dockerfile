FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS frontend
WORKDIR /app
COPY package.json ./
COPY index.html ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
ARG MEMORY_SPACE=spaces/together
RUN MEMORY_MODE=live MEMORY_SPACE="$MEMORY_SPACE" node scripts/build.mjs

FROM nginx:1.30.6-alpine@sha256:901e593c95dc85f5a729f5765516321366ef4ac401821431d408897e95287d0a
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend /app/dist /usr/share/nginx/html
