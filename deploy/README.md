# Deploy a Hetzner — pipeline CI/CD

Pipeline GitHub Actions que construye los servicios cambiados, los
publica a GHCR (GitHub Container Registry), y los despliega por SSH a
un servidor Hetzner Cloud. **Sólo se rebuildean y reinician los
servicios cuyo código cambia**; postgres / redis / minio / nginx
quedan intocados salvo que alguien modifique sus paths.

## Cómo funciona

1. **Push a `main`** dispara `.github/workflows/deploy.yml`.
2. `detect-changes` compara HEAD vs `event.before` y, cruzando con
   `deploy/services.json`, emite una matriz `{include:[{name,
   dockerfile}]}`.
3. `build-and-push` corre N jobs en paralelo, uno por servicio
   cambiado. Cada uno:
   - Buildea con buildx + cache en GitHub Actions cache.
   - Publica a `ghcr.io/<owner>/apphub-<svc>:<sha>` y `:latest`.
4. `deploy` abre SSH, sincroniza la configuración (docker-compose,
   infra/, deploy/) al SHA recién publicado, exporta
   `IMAGE_TAG=<sha>`, y corre `deploy/server/deploy.sh` con la lista
   de servicios. El script:
   - `docker compose pull <servicios>` → sólo descarga las imágenes
     nombradas.
   - `docker compose up -d --no-deps <servicios>` → sólo recrea esos
     contenedores. El resto (postgres/redis/etc.) sigue funcionando.
   - Healthcheck loop (20s) por servicio; salida no-cero si alguno
     no llega a `running`/`healthy`.

Cuando una PR sigue abierta o se hace push a otra rama, **no se
despliega** — sólo se valida vía `.github/workflows/ci.yml`
(lint + test + sanity-build de los servicios cambiados sin push).

## Setup — una sola vez

### 1) GitHub secrets

En `Settings > Secrets and variables > Actions > New repository secret`:

| Secret | Contenido | De dónde sale |
|---|---|---|
| `HETZNER_HOST` | IP pública o hostname del servidor | Panel Hetzner Cloud → tu servidor |
| `HETZNER_USER` | usuario SSH del servidor (e.g. `deploy`) | el que crees en el server |
| `HETZNER_SSH_KEY` | clave privada SSH (formato PEM, contenido completo) | `ssh-keygen -t ed25519 -f ~/.ssh/apphub-deploy` y pega `cat ~/.ssh/apphub-deploy` |
| `HETZNER_PORT` | (opcional) puerto SSH si no es 22 | sólo si cambiaste el default |

`GITHUB_TOKEN` lo provee Actions automáticamente — no hay que añadirlo.

### 2) Servidor Hetzner — preparación del host

Sobre un Ubuntu / Debian fresco:

```bash
# 1. Instala docker engine + compose plugin (oficial).
curl -fsSL https://get.docker.com | sh
sudo apt-get install -y docker-compose-plugin git

# 2. Crea el usuario de deploy + clave SSH.
sudo adduser --disabled-password --gecos '' deploy
sudo usermod -aG docker deploy
sudo mkdir -p /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
# Pega aquí la clave PÚBLICA correspondiente al HETZNER_SSH_KEY de GitHub:
sudo nano /home/deploy/.ssh/authorized_keys
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys

# 3. Clona el repo en ~/apphub del usuario deploy (el workflow asume
#    /home/deploy/apphub como ruta). Como el directorio vive bajo el
#    home del usuario, no hace falta sudo a partir de aquí.
sudo -u deploy bash -c '
  cd ~
  git clone https://github.com/<owner>/apphub.git apphub
  cd apphub
  git checkout main
'

# 4. Crea /home/deploy/apphub/.env con los secretos de producción.
sudo -u deploy nano /home/deploy/apphub/.env
#    - PLATFORM_JWT_SECRET=…
#    - SVC_PLATFORM_*_DB_PASSWORD=…
#    - PLATFORM_CONFIG_ENCRYPTION_KEY=…
#    - IMAGE_REGISTRY=ghcr.io/<tu-org>   (opcional — default ghcr.io/lafrigolet)
#    - cualquier otra credencial (SendGrid, Stripe, etc.)

# 5. Login a GHCR como el usuario deploy. Para que el pull anónimo
#    funcione hace falta un PAT con scope `read:packages`. Genera uno
#    en github.com/settings/tokens, pégalo:
read -s GH_PAT
sudo -u deploy bash -c "echo '$GH_PAT' | docker login ghcr.io -u <tu-usuario> --password-stdin"
#    (Si las imágenes son públicas no hace falta — el workflow las
#    publica como `private` por defecto cuando el repo es privado.)

# 6. Primer arranque: el workflow se encargará después, pero la primera
#    vez conviene levantar la infra manualmente para verificar:
sudo -u deploy bash -c '
  cd /home/deploy/apphub
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres redis minio nginx
'
```

### 3) Primer deploy

Una vez los secrets están puestos:

- O bien haces `git push origin main` y el deploy arranca solo.
- O bien fuerzas un deploy completo desde la pestaña **Actions** →
  "deploy-production" → "Run workflow", dejando `services` vacío
  (auto-detect). Para forzar redespliegue de un servicio en concreto:
  `services: aikikan-server,platform-core`.

## Qué hace SÍ y qué hace NO

| ✅ Sí | ❌ No |
|---|---|
| Detecta servicios cambiados via `services.json` + git diff | Detectar cambios en `infra/postgres/init/*.sql` (sólo se aplican en DB virgen) |
| Build paralelo con cache en GitHub Actions | Push de imágenes a otro registry (Docker Hub, ECR) — se puede pero el ejemplo está en GHCR |
| Pull selectivo + restart selectivo en el servidor | Recreate `postgres` / `redis` / `minio` salvo cambio explícito |
| Healthcheck post-deploy con timeout | Rollback automático si la healthcheck falla (lo deja como FAILED en Actions; el operador inspecciona) |
| Re-deploy forzado vía workflow_dispatch | Blue-green / zero-downtime; el restart de cada container tiene ~5s de downtime |

## Rollback rápido

```bash
ssh deploy@<host>
cd /home/deploy/apphub

# Encuentra el SHA previo (logs de Actions o git log).
PREV=<sha-anterior>

# Re-deploy con el SHA viejo.
export IMAGE_TAG=$PREV
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull <servicio>
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps <servicio>
```

Las imágenes con SHA persisten en GHCR (no expiran salvo policy
explícita), así que se puede revertir a cualquier commit ya desplegado.

## Operación recurrente

- **Ver estado**: `docker compose ps`.
- **Logs**: `docker compose logs --tail 100 -f <svc>`.
- **Migraciones DB**: corren automáticamente al arrancar cada módulo
  (`runMigrations` del package). No hay paso de deploy aparte.
- **Limpieza de imágenes viejas**: cron mensual recomendado.
  ```bash
  docker image prune -a --filter "until=336h" -f      # > 14 días
  ```

## Decisiones de diseño

- **GHCR sobre Docker Hub / ECR** — gratis para repos públicos
  ilimitado, gratis para privados con cuota generosa, integración
  native con Actions (no hace falta token externo para push). Si se
  necesita otro registry, sólo cambia `IMAGE_REGISTRY` en `.env` y
  los `tags` del workflow.
- **Cache buildx en `type=gha`** — gratis, automático, persistente
  entre runs. Build de un servicio inalterado tarda ~30s (todo cache),
  con cambios tarda 2-6 min.
- **SSH + `appleboy/ssh-action`** sobre alternativas (Watchtower, Argo
  CD, Portainer agent). Razón: lo más simple que funciona en un solo
  host Hetzner; coste cero de mantenimiento. Si se va a multi-host,
  pasarse a Docker Swarm o a un orquestador pesado tiene sentido.
- **Imágenes públicas vs privadas**: el repo manda. Si es privado, GHCR
  publica privadas y el server necesita login. Si el repo es público,
  las imágenes son públicas por defecto y el login es opcional.
- **No hay paso de tests en deploy.yml** — eso ya lo hace `ci.yml`
  contra cualquier rama. `deploy.yml` confía en que main está verde
  (asunción operativa: branch protection con required check de CI).

## Troubleshooting

**"No tag manifest found"** al pullear → el build job correspondiente
falló pero el deploy job arrancó igualmente. Mira la pestaña Actions
de ese servicio; suele ser una syntax error en un Dockerfile o falta
de un build-arg.

**Healthcheck timeout en el deploy** → el container arranca pero no
responde a su endpoint `/health`. Casi siempre es una env var faltante
en `/home/deploy/apphub/.env` (la imagen es nueva, requiere una nueva variable
que no añadiste). `docker compose logs --tail 200 <svc>` lo dice.

**Diff vacío pero el deploy debería correr** → comprueba que el
servicio que tocaste tiene su path en `deploy/services.json`. Si no,
añádelo y vuelve a empujar. La heurística sólo ve los paths declarados.

**Rebuild completo accidental** → suele pasar por cambios a
`pnpm-lock.yaml`, `pnpm-workspace.yaml`, o `deploy/services.json`
mismo (que dispara full por seguridad). Es la decisión correcta: si
el lockfile cambia, todos los servicios podrían tener deps distintas.
