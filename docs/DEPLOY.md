# Deploy a producción

Pipeline de despliegue **autónomo y seguro**: el agente escribe código y abre
PRs; el deploy lo hace **GitHub Actions** por SSH cuando se mergea a la rama
`production`. Las credenciales viven en **GitHub Secrets**, nunca en el agente.

```
Agente → PR → merge a `production` → GitHub Actions → SSH al VPS
       → backup BD → git pull → docker compose up -d --build → migrate deploy
       → healthcheck → (si falla) rollback al commit anterior
```

## 1. Requisitos en el VPS (una sola vez)

1. Docker + Docker Compose v2 instalados.
2. El repo clonado en una carpeta, ej. `/opt/sueldos` (será `APP_DIR`).
3. El archivo `.env` de producción creado ahí (NO se versiona) con
   `DATABASE_URL`, `JWT_SECRET`, etc. (ver `.env.example`).
4. Un **usuario dedicado de deploy** con acceso a Docker y a esa carpeta
   (mínimo privilegio; no uses root).
5. Su clave pública SSH autorizada (`~/.ssh/authorized_keys`).
6. Primer arranque manual para crear la BD y el volumen:
   ```bash
   cd /opt/sueldos
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   docker compose exec backend npm run prisma:migrate
   docker compose exec backend npm run prisma:seed   # solo la primera vez
   ```

## 2. Secrets a cargar en GitHub

`Settings → Secrets and variables → Actions → New repository secret`:

| Secret | Qué es | Ejemplo |
|---|---|---|
| `SSH_HOST` | IP o dominio del VPS | `185.x.x.x` |
| `SSH_USER` | usuario de deploy | `deploy` |
| `SSH_PORT` | puerto SSH (opcional, default 22) | `22` |
| `SSH_KEY` | clave **privada** del usuario de deploy (PEM completo) | `-----BEGIN OPENSSH PRIVATE KEY----- …` |
| `APP_DIR` | carpeta del repo en el VPS | `/opt/sueldos` |

> La clave privada solo vive en Secrets (cifrada). Para revocar el acceso del
> pipeline: borrá `SSH_KEY` o quitá la pública del `authorized_keys` del VPS.

## 3. Cómo se dispara

- **Automático:** al mergear a la rama `production`. Creala una vez:
  ```bash
  git checkout -b production && git push -u origin production
  ```
  Flujo normal: el agente trabaja en `claude/...` → PR → revisás → mergeás a
  `production` → se despliega.
- **Manual:** pestaña *Actions → Deploy a producción → Run workflow*.

## 4. Qué hace el deploy (`scripts/deploy.sh`)

1. **Backup** de la BD (`pg_dump | gzip` en `backups/`, retiene los últimos 14).
2. `git fetch` + `reset --hard origin/production`.
3. `docker compose up -d --build` (overlay de prod).
4. `prisma migrate deploy` (idempotente, seguro en prod).
5. **Healthcheck** a `http://localhost:3000/health` con reintentos.
6. Si el healthcheck falla → **rollback** al commit anterior y rebuild.

Nunca corre `down -v` (eso borraría el volumen de la BD con los sueldos).

## 5. Hardening recomendado (sueldos = datos personales)

- **No exponer la BD a internet.** En `docker-compose.yml` el puerto de Postgres
  está como `5432:5432`. En el VPS de prod conviene dejarlo accesible solo
  localmente: cambiá esa línea a `"127.0.0.1:5432:5432"` (o quitá el mapeo si
  nada externo se conecta).
- **Firewall** (ufw): permitir solo 22, 80, 443. No exponer 3000/5432.
- **HTTPS** delante (nginx/Caddy/Traefik con Let's Encrypt).
- **Backups fuera del VPS**: copiá `backups/*.sql.gz` a almacenamiento externo
  (otra región/proveedor) periódicamente.
- **Rotar `JWT_SECRET`/`JWT_REFRESH_SECRET`** y mantener `.env` fuera de git.
- Más adelante: separar **staging** de producción y poner aprobación manual
  (GitHub Environments) antes de prod.

## 6. Probar el pipeline sin romper nada

La primera vez, disparalo **manualmente** (`workflow_dispatch`) con un cambio
trivial y mirá los logs en Actions. El healthcheck + rollback te protegen: si la
nueva versión no levanta sana, el script vuelve sola a la anterior.
