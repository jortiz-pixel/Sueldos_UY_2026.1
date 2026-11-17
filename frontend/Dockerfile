FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
# Cache-bust: fuerza recompilar el dist en cada commit nuevo (evita servir dist viejo).
ARG APP_VERSION=dev
RUN echo "Compilando frontend $APP_VERSION" && npm run build

# Production: serve with nginx
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
