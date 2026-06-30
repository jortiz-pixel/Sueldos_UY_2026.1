#!/usr/bin/env bash
# Instalación ÚNICA del auto-deploy de Sueldos UY.
# Crea un systemd timer que revisa GitHub cada minuto y, si hay un commit nuevo,
# despliega solo. Ejecutar UNA sola vez:  sudo bash deploy/install-autodeploy.sh
set -euo pipefail

REPO_DIR="/root/Sueldos_UY_2026.1"

if [ ! -f "$REPO_DIR/deploy/auto-deploy.sh" ]; then
  echo "❌ No se encuentra $REPO_DIR/deploy/auto-deploy.sh. Hacé git pull primero."
  exit 1
fi
chmod +x "$REPO_DIR/deploy/auto-deploy.sh"

cat > /etc/systemd/system/sueldos-deploy.service <<EOF
[Unit]
Description=Auto-deploy Sueldos UY (pull + build si hay commits nuevos)
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
WorkingDirectory=$REPO_DIR
ExecStart=/usr/bin/env bash $REPO_DIR/deploy/auto-deploy.sh
EOF

cat > /etc/systemd/system/sueldos-deploy.timer <<EOF
[Unit]
Description=Revisa GitHub y despliega Sueldos UY cada minuto

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=15s

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now sueldos-deploy.timer

echo ""
echo "✅ Auto-deploy instalado y activo."
echo "   Cada push a la branch se aplica solo en ~1 minuto."
echo ""
echo "   Ver estado:   systemctl status sueldos-deploy.timer --no-pager"
echo "   Ver deploys:  journalctl -u sueldos-deploy.service -f"
echo "   Forzar ahora: systemctl start sueldos-deploy.service"
echo "   Desactivar:   systemctl disable --now sueldos-deploy.timer"
