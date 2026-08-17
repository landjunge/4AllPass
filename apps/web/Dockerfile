FROM node:22-slim AS build

WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/crypto/package.json packages/crypto/
COPY apps/web/package.json apps/web/
RUN npm ci --workspaces --include-workspace-root

COPY packages/crypto packages/crypto
COPY apps/web apps/web
RUN npm run build -w @4allpass/web

FROM nginx:alpine
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
