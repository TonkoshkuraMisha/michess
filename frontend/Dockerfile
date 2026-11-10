# --- FILE: frontend/Dockerfile ---
# Сборка фронтенда и раздача статики через nginx, который же проксирует API и WebSocket
# на бэкенд — фронтенд и API на одном домене, CORS не нужен.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# VITE_API_URL / VITE_WS_URL не задаём: в продакшен-сборке API берётся с того же домена.
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
# .inc, а не .conf: штатный nginx.conf подключает только conf.d/*.conf, а этот файл
# включается вручную внутри server и location.
COPY security_headers.inc /etc/nginx/conf.d/security_headers.inc
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
