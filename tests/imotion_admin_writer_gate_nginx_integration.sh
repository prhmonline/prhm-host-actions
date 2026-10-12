#!/usr/bin/env bash
# CI-only, disposable Nginx integration. No host production config and no network.
set -Eeuo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
NGINX_IMAGE='nginx@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10'
DEST_ROOT='/home/imotion/domains/admin.i-motion.ir/public_html/app/web'
D="$(mktemp -d /tmp/imotion-gate-ci-XXXXXXXX)"
NAME="imotion-gate-integration-$$"
cleanup() {
  status=$?
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf -- "$D"
  echo "SANDBOX_CLEANUP exit=$status"
  exit "$status"
}
trap cleanup EXIT
install -d -m 0755 "$D/certs" "$D/web/assets" "$D/flag"
chmod 0755 "$D"
printf 'static-file-test\n' > "$D/web/assets/.empty"
printf '<?php http_response_code(200); ?>\n' > "$D/web/index.php"
openssl req -x509 -nodes -newkey rsa:2048 -sha256 -days 1 \
  -keyout "$D/certs/key.pem" -out "$D/certs/cert.pem" \
  -subj '/CN=admin.i-motion.ir' >/dev/null 2>&1
python3 - "$REPO" "$D" <<'PY'
import importlib.util
import pathlib
import sys

repo, root = map(pathlib.Path, sys.argv[1:])
path = repo / "tests" / "test_imotion_admin_writer_gate.py"
spec = importlib.util.spec_from_file_location("gate_test_fixture", str(path))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
source = module.FIXTURE
assert source.count("http {\n") == 1
source = (
    "user nginx;\n"
    "worker_processes 1;\n"
    "events { worker_connections 256; }\n"
    + source.replace(
      "http {\n",
      "http {\n"
      "  ssl_certificate /etc/nginx/test-certs/cert.pem;\n"
      "  ssl_certificate_key /etc/nginx/test-certs/key.pem;\n",
      1,
    )
)
(root / "source.conf").write_text(source)
PY
SOURCE_SHA="$(sha256sum "$D/source.conf" | awk '{print $1}')"
python3 "$REPO/ops/imotion/admin_writer_gate.py" \
  --input "$D/source.conf" --output "$D/candidate.conf" \
  --expected-sha256 "$SOURCE_SHA"
echo "SOURCE_BINDING_VALIDATED"
docker run --rm --network none \
  --mount type=bind,src="$D/candidate.conf",dst=/etc/nginx/nginx.conf,readonly \
  --mount type=bind,src="$D/certs",dst=/etc/nginx/test-certs,readonly \
  --mount type=bind,src="$D/web",dst="$DEST_ROOT",readonly \
  --mount type=bind,src="$D/flag",dst=/run/prhm-imotion-writer-gate,readonly \
  --tmpfs /var/cache/nginx:rw,nosuid,size=8m \
  --tmpfs /var/log/nginx:rw,nosuid,size=8m \
  "$NGINX_IMAGE" nginx -t >/dev/null 2>&1
echo "NGINX_SYNTAX_PASS"
docker run --rm -d --network none --name "$NAME" \
  --memory 256m --pids-limit 128 \
  --mount type=bind,src="$D/candidate.conf",dst=/etc/nginx/nginx.conf,readonly \
  --mount type=bind,src="$D/certs",dst=/etc/nginx/test-certs,readonly \
  --mount type=bind,src="$D/web",dst="$DEST_ROOT",readonly \
  --mount type=bind,src="$D/flag",dst=/run/prhm-imotion-writer-gate,readonly \
  --tmpfs /var/cache/nginx:rw,nosuid,size=8m \
  --tmpfs /var/log/nginx:rw,nosuid,size=8m \
  "$NGINX_IMAGE" >/dev/null
test "$(docker inspect "$NAME" --format '{{.HostConfig.NetworkMode}}')" = 'none'
test "$(docker inspect "$NAME" --format '{{json .HostConfig.PortBindings}}')" = '{}'
echo "ISOLATION_NO_NETWORK_NO_PORTS_PASS"
ready=0
for _ in $(seq 1 20); do
  if docker exec "$NAME" curl -ksS --max-time 2 \
    --resolve admin.i-motion.ir:443:127.0.0.1 \
    https://admin.i-motion.ir/assets/.empty >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
test "$ready" -eq 1

probe() {
  method="$1"; uri="$2"; expected="$3"
  host="$(if test "$#" -ge 4; then printf '%s' "$4"; else printf '%s' 'admin.i-motion.ir'; fi)"
  status="$(docker exec "$NAME" curl -ksS --max-time 5 -X "$method" \
    --resolve "$host:443:127.0.0.1" -o /dev/null -w '%{http_code}' \
    "https://$host$uri")"
  if [ "$status" != "$expected" ]; then
    echo "HTTP_FAIL method=$method uri=$uri host=$host expected=$expected got=$status"; return 1
  fi
  echo "HTTP_PASS method=$method uri=$uri host=$host status=$status"
}
echo "FLAG_OFF_BASELINE"
probe GET /__dynamic_probe 502
probe POST /__dynamic_probe 502
probe OPTIONS /__dynamic_probe 204
probe GET /index.php 502
probe GET /assets/.empty 200
probe GET /nginx-status 204
probe GET / 200 other.example
probe GET / 301 admin.imotion.ir

printf 'test-active\n' > "$D/flag/admin-i-motion-ir.cutover"
chmod 0644 "$D/flag/admin-i-motion-ir.cutover"
docker exec -u 101:101 "$NAME" sh -c \
  'test -r /run/prhm-imotion-writer-gate/admin-i-motion-ir.cutover && test ! -w /run/prhm-imotion-writer-gate'
docker exec -u 1004:1005 "$NAME" sh -c \
  'test ! -w /run/prhm-imotion-writer-gate; ! touch /run/prhm-imotion-writer-gate/forbidden 2>/dev/null'
echo "WORKER_READONLY_ROOT_MOUNT_PASS"
echo "FLAG_ON"
probe GET /__dynamic_probe 503
probe POST /__dynamic_probe 503
probe PUT /__dynamic_probe 503
probe PATCH /__dynamic_probe 503
probe DELETE /__dynamic_probe 503
probe OPTIONS /__dynamic_probe 503
probe GET /index.php 503
probe GET /assets/.empty 200
probe GET /nginx-status 204
probe GET / 200 other.example
probe GET / 301 admin.imotion.ir
rm -f "$D/flag/admin-i-motion-ir.cutover"
echo "FLAG_REMOVED"
probe GET /__dynamic_probe 502
probe OPTIONS /__dynamic_probe 204
echo "ISOLATED_REAL_NGINX_INTEGRATION_PASS"
