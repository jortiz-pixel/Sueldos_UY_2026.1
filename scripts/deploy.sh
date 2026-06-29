#!/usr/bin/env bash
# ============================================================
# deploy.sh — se ejecuta EN EL VPS de producción.
# Estrategia: git pull + docker compose build (sin registry).
#
# Lo invoca el workflow de GitHub Actions por SSH:
#   ssh ... "bash -s" -- "<APP_DIR>" "<BRANCH>" < scripts/deploy.sh
#
# Seguridad (sueldos = datos sensibles):
#  - Backup de la BD ANTES de tocar nada.
#  - Migraciones con `migrate deploy` (nunca `dev`).
#  - Healthcheck con reintentos; si falla → rollback al commit anterior.
#  - Nunca usa `down -v` (eso borraría la base).
# ============================================================
set -euo pipefail

APP_DIR="${1:?uso: deploy.sh <APP_DIR> [BRANCH]}"
BRANCH="${2:-production}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/health}"

cd "$APP_DIR"
echo "==> Deploy en $APP_DIR (rama $BRANCH)"

# Commit actual: punto de retorno para el rollback.
PREV_SHA="$(git rev-parse HEAD)"
echo "==> Commit previo (rollback target): $PREV_SHA"

rebuild() {
  $COMPOSE up -d --build
}

healthcheck() {
  for _ in $(seq 1 12); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 5
  done
  return 1
}

# 1. Backup de la BD (no aborta el deploy si la BD aún no existe).
TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p backups
echo "==> Backup de la BD -> backups/db-$TS.sql.gz"
if $COMPOSE exec -T postgres pg_dump -U "${POSTGRES_USER:-sueldos_user}" \
     "${POSTGRES_DB:-sueldos_uy}" 2>/dev/null | gzip > "backups/db-$TS.sql.gz"; then
  echo "    backup OK"
else
  echo "    ADVERTENCIA: no se pudo hacer backup (¿primer deploy? ¿BD abajo?)"
  rm -f "backups/db-$TS.sql.gz"
fi
# Retención: conservar los últimos 14 backups.
ls -1t backups/db-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f

# 2. Traer el código de la rama de deploy.
echo "==> git fetch + checkout $BRANCH"
git fetch --all --prune
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

# 3. Construir y levantar.
echo "==> docker compose up -d --build"
rebuild

# 4. Migraciones (migrate deploy, idempotente y seguro en prod).
echo "==> Migraciones Prisma (migrate deploy)"
$COMPOSE exec -T backend npm run prisma:migrate

# 5. Healthcheck; si falla, rollback al commit previo.
echo "==> Healthcheck en $HEALTH_URL"
if healthcheck; then
  echo "==> Deploy OK ✔ ($TS) — $(git rev-parse --short HEAD)"
else
  echo "==> Healthcheck FALLÓ — rollback a $PREV_SHA"
  git reset --hard "$PREV_SHA"
  rebuild
  if healthcheck; then
    echo "==> Rollback OK — el servicio quedó en la versión previa."
  else
    echo "==> ERROR CRÍTICO: el rollback tampoco levanta sano. Revisar el VPS."
  fi
  exit 1
fi
