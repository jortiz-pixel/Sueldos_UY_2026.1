#!/usr/bin/env bash
# Auto-deploy de Sueldos UY.
#
# Lo ejecuta periódicamente un systemd timer (ver deploy/install-autodeploy.sh).
# Si hay un commit nuevo en la branch, hace pull + rebuild + migraciones.
# Solo usa salida HTTPS hacia GitHub: NO requiere abrir puertos en el firewall.
set -uo pipefail

REPO_DIR="/root/Sueldos_UY_2026.1"
BRANCH="claude/uruguayan-payroll-system-EojHu"

FORCE="${1:-}"

cd "$REPO_DIR" || { echo "No existe $REPO_DIR"; exit 1; }

# ¿Hay algo nuevo en el remoto?
git fetch origin "$BRANCH" --quiet || { echo "[$(date '+%F %T')] git fetch falló (se reintenta luego)"; exit 0; }
LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null)
[ -z "$REMOTE" ] && exit 0
if [ "$FORCE" != "--force" ] && [ "$LOCAL" = "$REMOTE" ]; then
  exit 0   # ya estamos al día (salvo build forzado)
fi

echo "[$(date '+%F %T')] Desplegando $REMOTE…"
git reset --hard "origin/$BRANCH" || { echo "fallo git reset"; exit 1; }

# 1) Construir las imágenes nuevas. Los contenedores ANTERIORES siguen sirviendo
#    durante todo el build → cero interrupción en este paso.
echo "[$(date '+%F %T')] Construyendo imágenes…"
docker compose build || { echo "fallo docker compose build — se mantiene la versión anterior"; exit 1; }

# 2) Aplicar migraciones de base con la imagen NUEVA, en un contenedor temporal,
#    ANTES de cambiar la app en vivo. Si falla, se ABORTA y queda la versión
#    anterior corriendo (no se deja la base/código en estado inconsistente).
echo "[$(date '+%F %T')] Aplicando migraciones…"
docker compose run --rm -T backend npm run prisma:migrate || {
  echo "[$(date '+%F %T')] ❌ MIGRACIÓN FALLÓ — se mantiene la versión anterior. Revisar a mano.";
  exit 1;
}

# 3) Cambiar a las imágenes nuevas (recreación rápida = pocos segundos).
docker compose up -d || { echo "fallo docker compose up"; exit 1; }

echo "[$(date '+%F %T')] Deploy OK ($REMOTE)"
