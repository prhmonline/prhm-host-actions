#!/usr/bin/env bash
# PRHM standalone WAHA bootstrap. Source-controlled; deploy only from verified Git SHA.
# Does not touch PRHM Agent, control-plane Policy, or existing site services.
set -Eeuo pipefail
if (( EUID != 0 )); then echo "ERROR: run as root" >&2; exit 1; fi
for tool in git docker openssl curl; do command -v "$tool" >/dev/null || { echo "ERROR: missing $tool" >&2; exit 1; }; done
docker compose version >/dev/null || { echo "ERROR: Docker Compose v2 required" >&2; exit 1; }
[[ "$(uname -m)" == "x86_64" ]] || { echo "ERROR: this pinned WAHA image is linux/amd64 only" >&2; exit 1; }
src="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root="$(git -C "$src" rev-parse --show-toplevel)"
sha="$(git -C "$root" rev-parse HEAD)"
[[ -z "$(git -C "$root" status --porcelain --untracked-files=no)" ]] || { echo "ERROR: tracked Git worktree dirty" >&2; exit 1; }
data=/opt/prhm-waha
umask 077
install -d -m 0700 "$data" "$data/sessions" "$data/media"
if [[ ! -e "$data/.env" ]]; then
  key="$(openssl rand -hex 32)"
  pass="$(openssl rand -hex 24)"
  swagger_pass="$(openssl rand -hex 24)"
  cat > "$data/.env" <<EOF
WAHA_API_KEY=$key
WHATSAPP_API_KEY_EXCLUDE_PATH=ping
WAHA_DASHBOARD_ENABLED=true
WAHA_DASHBOARD_USERNAME=admin
WAHA_DASHBOARD_PASSWORD=$pass
WHATSAPP_SWAGGER_ENABLED=false
WHATSAPP_SWAGGER_USERNAME=admin
WHATSAPP_SWAGGER_PASSWORD=$swagger_pass
WAHA_PRINT_QR=false
EOF
  chmod 0600 "$data/.env"
fi
cat > "$data/compose.yaml" <<'YAML'
name: prhm-waha
services:
  waha:
    image: devlikeapro/waha:gows-2026.9.2
    container_name: prhm-waha
    restart: unless-stopped
    ports:
      - "127.0.0.1:3101:3000"
    env_file:
      - /opt/prhm-waha/.env
    environment:
      WHATSAPP_DEFAULT_ENGINE: GOWS
    volumes:
      - /opt/prhm-waha/sessions:/app/.sessions
      - /opt/prhm-waha/media:/app/.media
    security_opt:
      - no-new-privileges:true
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
YAML
chmod 0600 "$data/compose.yaml"
docker compose -f "$data/compose.yaml" config -q
docker compose -f "$data/compose.yaml" pull
docker compose -f "$data/compose.yaml" up -d
# The /health endpoint requires authentication when API-key protection is enabled.
# Verify the same authenticated API endpoint used by the production diagnostic.
api_key="$(sed -n 's/^WAHA_API_KEY=//p' "$data/.env" | head -n 1)"
[[ -n "$api_key" ]] || { echo "ERROR: missing WAHA_API_KEY" >&2; exit 1; }
healthy=0
for i in $(seq 1 40); do
  if curl --silent --fail --max-time 3 -H "X-Api-Key: $api_key" http://127.0.0.1:3101/api/server/version >/dev/null; then healthy=1; break; fi
  sleep 2
done
unset api_key
echo "DEPLOY_SOURCE_SHA=$sha"
echo "CREDENTIALS_FILE=$data/.env (root-only, NEVER paste into chat)"
echo "LOCAL_DASHBOARD=http://localhost:3101/dashboard"
docker compose -f "$data/compose.yaml" ps
if (( healthy )); then
  echo "WAHA_HTTP_HEALTH=PASS"
  # The actual WhatsApp session must be paired by its account owner via QR.
else
  echo "WAHA_HTTP_HEALTH=FAIL; inspect: docker logs --tail 80 prhm-waha" >&2
  exit 1
fi
