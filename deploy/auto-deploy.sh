#!/usr/bin/env bash
# Auto-deploy de Sueldos UY.
#
# Lo ejecuta periódicamente un systemd timer (ver deploy/install-autodeploy.sh).
# Si hay un commit nuevo en la branch, hace pull + rebuild + migraciones.
# Solo usa salida HTTPS hacia GitHub: NO requiere abrir puertos en el firewall.
set -uo pipefail

REPO_DIR="/root/Sueldos_UY_2026.1"
BRANCH="claude/uruguayan-payroll-system-EojHu"

cd "$REPO_DIR" || { echo "No existe $REPO_DIR"; exit 1; }

# ¿Hay algo nuevo en el remoto?
git fetch origin "$BRANCH" --quiet || { echo "[$(date '+%F %T')] git fetch falló (se reintenta luego)"; exit 0; }
LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null)
[ -z "$REMOTE" ] && exit 0
[ "$LOCAL" = "$REMOTE" ] && exit 0   # ya estamos al día

echo "[$(date '+%F %T')] Nuevo commit detectado: $REMOTE — desplegando…"
git reset --hard "origin/$BRANCH" || { echo "fallo git reset"; exit 1; }

# Rebuild + levantar contenedores
docker compose up -d --build || { echo "fallo docker compose up"; exit 1; }

# Migraciones de base (idempotente: aplica solo lo pendiente; si no hay, no hace nada)
docker compose exec -T backend npm run prisma:migrate || echo "aviso: prisma:migrate devolvió error (puede no haber migraciones pendientes)"

echo "[$(date '+%F %T')] Deploy OK ($REMOTE)"
