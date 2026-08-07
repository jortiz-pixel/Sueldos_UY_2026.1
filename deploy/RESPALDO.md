# Respaldo automático a OneDrive

Respaldo diario de **AsysTax. Sueldos** hacia OneDrive, en dos capas:

1. **Copia técnica** (para restaurar TODO el sistema): `pg_dump` de la base +
   `tar.gz` de los adjuntos. Queda en `Tecnico/`.
2. **Export legible por empresa** (para consultar sin el sistema): una carpeta
   por empresa con Excel, PDF (recibos y contratos), archivos `.bps` de nómina,
   adjuntos y un `datos.json` de fidelidad total.

```
AsysTax Respaldo/                (en OneDrive)
├── Tecnico/
│   ├── db-2026-08-07.sql.gz
│   └── adjuntos-2026-08-07.tar.gz
├── Empresas/
│   └── MI CASA S.A. (RUT 21...)/
│       ├── Empresa.xlsx
│       ├── datos.json
│       ├── Contratos/…pdf
│       ├── Liquidaciones/2026/06 - Junio/…pdf
│       ├── Nomina BPS/2026/N_0626_….bps
│       └── Adjuntos/Pérez Juan/…
└── LEEME.txt
```

## Instalación (una sola vez, en el servidor)

```bash
cd /root/Sueldos_UY_2026.1
git pull
sudo bash deploy/install-backup.sh
```

El instalador:
- instala `rclone` si falta,
- si todavía no configuraste OneDrive, te pide correr `rclone config` (abre un
  link para autorizar tu cuenta de `gro.com.uy`),
- crea el timer de systemd que corre el respaldo **todos los días ~03:00**.

### Configurar OneDrive (rclone)

```bash
rclone config
#  n (new)  →  name: onedrive  →  storage: onedrive
#  seguí el asistente (OneDrive Personal o Business)
```

Si el servidor no tiene navegador: cuando pregunte *"Use auto config?"* respondé
**No** y usá `rclone authorize "onedrive"` desde tu PC; pegás el token que te da.

## Ajustes opcionales

Copiá `deploy/backup.env.example` a `deploy/backup.env` y editá la carpeta
destino, el nombre del remoto o los días de retención de los dumps técnicos.

## Uso y control

```bash
# Correr el respaldo ahora (y ver el progreso)
systemctl start sueldos-backup.service && journalctl -u sueldos-backup.service -f

# Próxima corrida / estado
systemctl list-timers sueldos-backup.timer --no-pager

# Desactivar
systemctl disable --now sueldos-backup.timer
```

## Restaurar (ante desastre)

```bash
# Base de datos
gunzip -c Tecnico/db-FECHA.sql.gz | docker exec -i sueldos_uy_db psql -U sueldos_user -d sueldos_uy

# Adjuntos
docker exec -i sueldos_uy_backend sh -c 'tar xzf - -C /app/storage' < Tecnico/adjuntos-FECHA.tar.gz
```
