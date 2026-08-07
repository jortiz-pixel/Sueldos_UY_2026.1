#!/usr/bin/env bash
# Respaldo de AsysTax. Sueldos → OneDrive.
#
# Dos capas:
#   1) Técnico (restaurar todo): pg_dump de la base + tar de los adjuntos.
#   2) Legible por empresa: export con carpetas, Excel, PDF y JSON.
# Después sincroniza TODO a OneDrive con rclone. Lo corre el timer de systemd
# (ver deploy/install-backup.sh). También se puede correr a mano.
set -euo pipefail

REPO_DIR="/root/Sueldos_UY_2026.1"
cd "$REPO_DIR" || { echo "No existe $REPO_DIR"; exit 1; }

# ── Configuración (se puede sobrescribir en deploy/backup.env) ──────
BACKUP_DIR="/root/asystax-respaldo"       # carpeta local de trabajo
RCLONE_REMOTE="onedrive"                   # nombre del remoto rclone (rclone config)
RCLONE_PATH="AsysTax Respaldo"             # carpeta destino en OneDrive
RETENCION_DIAS="30"                        # días que se conservan los dumps técnicos
DB_CONTAINER="sueldos_uy_db"
BACKEND_CONTAINER="sueldos_uy_backend"
POSTGRES_USER="sueldos_user"
POSTGRES_DB="sueldos_uy"
[ -f "$REPO_DIR/deploy/backup.env" ] && source "$REPO_DIR/deploy/backup.env"

FECHA="$(date +%F)"
log() { echo "[$(date '+%F %T')] $*"; }

mkdir -p "$BACKUP_DIR/Tecnico"

# ── 1) Copia técnica: base de datos ────────────────────────────────
log "Dump de la base de datos…"
docker exec "$DB_CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  | gzip > "$BACKUP_DIR/Tecnico/db-$FECHA.sql.gz"

# ── 1b) Copia técnica: adjuntos (fotos, cédulas, carnés) ───────────
log "Adjuntos…"
docker exec "$BACKEND_CONTAINER" tar czf - -C /app/storage . \
  > "$BACKUP_DIR/Tecnico/adjuntos-$FECHA.tar.gz" 2>/dev/null \
  || log "aviso: no se pudieron empaquetar los adjuntos (¿carpeta vacía?)"

# ── 2) Export legible por empresa ──────────────────────────────────
log "Export legible por empresa…"
docker exec "$BACKEND_CONTAINER" node dist/scripts/backup.js /tmp/asystax-export
rm -rf "$BACKUP_DIR/Empresas" "$BACKUP_DIR/LEEME.txt"
docker cp "$BACKEND_CONTAINER:/tmp/asystax-export/." "$BACKUP_DIR/"
docker exec "$BACKEND_CONTAINER" rm -rf /tmp/asystax-export

# ── 3) Retención local de la copia técnica ─────────────────────────
find "$BACKUP_DIR/Tecnico" -name 'db-*.sql.gz'       -mtime +"$RETENCION_DIAS" -delete 2>/dev/null || true
find "$BACKUP_DIR/Tecnico" -name 'adjuntos-*.tar.gz' -mtime +"$RETENCION_DIAS" -delete 2>/dev/null || true

# ── 4) Sincronizar todo a OneDrive ─────────────────────────────────
log "Sincronizando a OneDrive ($RCLONE_REMOTE:$RCLONE_PATH)…"
rclone sync "$BACKUP_DIR" "$RCLONE_REMOTE:$RCLONE_PATH" \
  --create-empty-src-dirs --transfers 4 --checkers 8 \
  || { log "fallo rclone sync — revisá 'rclone config' y la conexión"; exit 1; }

log "Respaldo completo. ✅"
