#!/usr/bin/env bash
# Deploy MANUAL de Sueldos UY.
#   Uso:  bash deploy/deploy.sh
#
# Trae lo último de la branch, compila, aplica migraciones y levanta —
# mostrándote el resultado en pantalla. La versión (commit) queda registrada
# y visible en la app (pie de la barra lateral) y en /api/version.
set -euo pipefail

REPO_DIR="/root/Sueldos_UY_2026.1"
BRANCH="claude/uruguayan-payroll-system-EojHu"
cd "$REPO_DIR"

echo "▶ Trayendo últimos cambios de $BRANCH…"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
COMMIT="$(git rev-parse --short HEAD)"
SUBJECT="$(git log -1 --pretty=%s)"
echo "  Commit: $COMMIT  —  $SUBJECT"

export APP_VERSION="$COMMIT"
export APP_BUILT_AT="$(date -u +%FT%TZ)"

echo "▶ Compilando imágenes…"
docker compose build

echo "▶ Aplicando migraciones de base…"
docker compose run --rm -T backend npm run prisma:migrate

echo "▶ Levantando contenedores…"
docker compose up -d

echo ""
echo "▶ Verificando exposición de puertos…"
if ss -tln 2>/dev/null | grep -qE '0\.0\.0\.0:5432|\[::\]:5432'; then
  echo "  ⚠️  ATENCIÓN: el 5432 (PostgreSQL) sigue expuesto a internet."
else
  echo "  ✔ PostgreSQL sin exposición pública."
fi

echo ""
echo "✅ Deploy OK"
echo "   Versión desplegada: $COMMIT  ($APP_BUILT_AT)"
echo "   Verificá en la app (pie de la barra lateral) o:"
echo "     curl -s localhost:3000/api/version"
