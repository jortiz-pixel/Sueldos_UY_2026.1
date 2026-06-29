#!/usr/bin/env bash
# ============================================================
# SessionStart hook — Sueldos UY 2026
# Deja el entorno listo para que un agente trabaje de forma
# autónoma: dependencias instaladas, Prisma client generado y
# (si hay Docker) Postgres levantado con migraciones aplicadas.
#
# Es idempotente y NO debe abortar la sesión: ante cualquier
# fallo de un paso opcional, avisa y continúa.
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 0

log() { printf '  [setup] %s\n' "$1"; }

# --- .env -----------------------------------------------------
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  log ".env creado a partir de .env.example (valores demo)."
fi

# --- Backend --------------------------------------------------
if [ -d backend ]; then
  log "Backend: instalando dependencias…"
  ( cd backend && npm install --no-audit --no-fund >/dev/null 2>&1 ) \
    && log "Backend: dependencias OK" \
    || log "Backend: npm install falló (revisar manualmente)"

  log "Backend: generando Prisma client…"
  ( cd backend && npm run prisma:generate >/dev/null 2>&1 ) \
    && log "Backend: Prisma client OK" \
    || log "Backend: prisma generate falló (revisar manualmente)"
fi

# --- Frontend -------------------------------------------------
if [ -d frontend ]; then
  log "Frontend: instalando dependencias…"
  ( cd frontend && npm install --no-audit --no-fund >/dev/null 2>&1 ) \
    && log "Frontend: dependencias OK" \
    || log "Frontend: npm install falló (revisar manualmente)"
fi

# --- Postgres + migraciones (opcional, requiere Docker) -------
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  log "Docker disponible: levantando Postgres…"
  if docker compose up -d postgres >/dev/null 2>&1; then
    # esperar healthcheck (máx ~30s)
    for _ in $(seq 1 15); do
      if docker compose exec -T postgres pg_isready -U sueldos_user -d sueldos_uy >/dev/null 2>&1; then
        break
      fi
      sleep 2
    done
    ( cd backend && npm run prisma:migrate:dev >/dev/null 2>&1 ) \
      && log "Postgres: migraciones aplicadas" \
      || log "Postgres: migrate falló (¿BD lista?)"
  else
    log "No se pudo levantar Postgres (continuo; los tests son sin BD)."
  fi
else
  log "Docker no disponible: omito Postgres. Los tests unitarios corren sin BD."
fi

# --- Smoke test -----------------------------------------------
if [ -d backend ]; then
  log "Backend: corriendo tests rápidos…"
  ( cd backend && npm test >/dev/null 2>&1 ) \
    && log "Tests: OK ✔" \
    || log "Tests: hay fallos — revisar con 'cd backend && npm test'"
fi

log "Entorno listo."
exit 0
