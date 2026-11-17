FROM node:20-alpine AS builder

WORKDIR /app

# OpenSSL is required by Prisma engines
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .
# Cache-bust de la compilación: APP_VERSION (el commit) cambia en cada despliegue,
# por lo que esta capa —y el `npm run build`— se rehace SIEMPRE que se despliega
# una versión nueva. Evita el problema de servir un `dist` viejo cacheado (el
# indicador de versión es de runtime y podía no coincidir con el código compilado).
ARG APP_VERSION=dev
RUN echo "Compilando backend $APP_VERSION" && npm run build
RUN npm run prisma:generate

# Production image
FROM node:20-alpine AS runner

RUN apk add --no-cache dumb-init openssl

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma/

# Logs + storage directories writable by the non-root node user
RUN mkdir -p /app/logs /app/storage && chown -R node:node /app

EXPOSE 3000

USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
