#!/usr/bin/env bash
# Instalación ÚNICA del respaldo automático a OneDrive.
# Crea un systemd timer que corre deploy/backup.sh todos los días.
# Ejecutar UNA sola vez:  sudo bash deploy/install-backup.sh
set -euo pipefail

REPO_DIR="/root/Sueldos_UY_2026.1"
RCLONE_REMOTE="onedrive"
[ -f "$REPO_DIR/deploy/backup.env" ] && source "$REPO_DIR/deploy/backup.env"

if [ ! -f "$REPO_DIR/deploy/backup.sh" ]; then
  echo "❌ No se encuentra $REPO_DIR/deploy/backup.sh. Hacé git pull primero."
  exit 1
fi
chmod +x "$REPO_DIR/deploy/backup.sh"

# ── 1) rclone instalado ────────────────────────────────────────────
if ! command -v rclone >/dev/null 2>&1; then
  echo "⏳ rclone no está instalado. Instalando…"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y rclone || true
  fi
  if ! command -v rclone >/dev/null 2>&1; then
    curl -fsSL https://rclone.org/install.sh | bash || {
      echo "❌ No se pudo instalar rclone automáticamente. Instalalo a mano: https://rclone.org/install/"
      exit 1
    }
  fi
fi
echo "✅ rclone $(rclone version | head -1)"

# ── 2) Remoto de OneDrive configurado ──────────────────────────────
if ! rclone listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE}:"; then
  echo ""
  echo "⚠️  Falta configurar el remoto de OneDrive '$RCLONE_REMOTE'."
  echo "    Corré UNA vez (interactivo, abre un link para autorizar tu cuenta):"
  echo ""
  echo "        rclone config"
  echo ""
  echo "    Elegí:  n (new)  →  nombre: $RCLONE_REMOTE  →  storage: onedrive"
  echo "    Seguí el asistente (OneDrive Personal o Business según tu cuenta gro.com.uy)."
  echo "    Si el servidor no tiene navegador, usá 'rclone authorize' desde tu PC"
  echo "    (el asistente te lo indica cuando pregunta 'Use auto config? → No')."
  echo ""
  echo "    Cuando termines, volvé a correr:  sudo bash deploy/install-backup.sh"
  echo ""
  read -r -p "¿Continuar igual instalando el timer (correrá cuando el remoto exista)? [s/N] " resp
  case "${resp:-N}" in [sS]) ;; *) exit 0 ;; esac
fi

# ── 3) systemd service + timer (diario) ────────────────────────────
cat > /etc/systemd/system/sueldos-backup.service <<EOF
[Unit]
Description=Respaldo de AsysTax Sueldos a OneDrive (base + export por empresa)
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
WorkingDirectory=$REPO_DIR
ExecStart=/usr/bin/env bash $REPO_DIR/deploy/backup.sh
EOF

cat > /etc/systemd/system/sueldos-backup.timer <<EOF
[Unit]
Description=Corre el respaldo de AsysTax Sueldos todos los días

[Timer]
OnCalendar=*-*-* 03:00:00
RandomizedDelaySec=20min
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now sueldos-backup.timer

echo ""
echo "✅ Respaldo automático instalado. Corre todos los días ~03:00 (hora del servidor)."
echo ""
echo "   Probar ahora:   systemctl start sueldos-backup.service && journalctl -u sueldos-backup.service -f"
echo "   Ver estado:     systemctl status sueldos-backup.timer --no-pager"
echo "   Próxima corrida: systemctl list-timers sueldos-backup.timer --no-pager"
echo "   Desactivar:     systemctl disable --now sueldos-backup.timer"
