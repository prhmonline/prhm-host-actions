#!/usr/bin/env bash
set -Eeuo pipefail

PORT="${1:-}"

case "$PORT" in
  8124|8125|8130) ;;
  *)
    echo 'FATAL: allowed candidate ports are 8124,8125,8130'
    exit 10
    ;;
esac

ENV=/etc/prhm-agent-mcp-auth.env
URL="http://127.0.0.1:${PORT}/mcp"
TMP="$(mktemp -d /run/prhm-mcp-preflight.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

[[ -r "$ENV" ]] || {
  echo 'FATAL: auth env unavailable'
  exit 11
}

set -a
. "$ENV"
set +a

TOKEN="${MCP_BEARER_TOKEN:-}"

[[ -n "$TOKEN" ]] || {
  echo 'FATAL: MCP_BEARER_TOKEN unavailable'
  exit 12
}

echo "candidate_port=$PORT"

echo '=== unauth control ==='

CODE="$(
  curl -sS \
    --connect-timeout 2 \
    --max-time 8 \
    -o /dev/null \
    -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    --data-binary \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"mcp-runtime-preflight","version":"1.0"}}}' \
    "$URL" || true
)"

echo "unauth_http=$CODE"

[[ "$CODE" == 401 || "$CODE" == 403 ]] || {
  echo 'FATAL: unauthenticated MCP request not rejected'
  exit 20
}

echo '=== authenticated initialize ==='

CODE="$(
  curl -sS \
    --connect-timeout 2 \
    --max-time 12 \
    -D "$TMP/init.headers" \
    -o "$TMP/init.body" \
    -w '%{http_code}' \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    --data-binary \
    '{"jsonrpc":"2.0","id":101,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"mcp-runtime-preflight","version":"1.0"}}}' \
    "$URL"
)"

echo "initialize_http=$CODE"

[[ "$CODE" == 200 ]] || {
  echo 'FATAL: initialize failed'
  exit 21
}

SESSION="$(
  awk '
    BEGIN {IGNORECASE=1}
    /^mcp-session-id:/ {
      gsub(/\r/,"",$2)
      print $2
    }
  ' "$TMP/init.headers" |
  tail -1
)"

HEADERS=(
  -H "Authorization: Bearer $TOKEN"
  -H 'Content-Type: application/json'
  -H 'Accept: application/json, text/event-stream'
)

[[ -z "$SESSION" ]] ||
  HEADERS+=(-H "Mcp-Session-Id: $SESSION")

echo '=== tools/list ==='

CODE="$(
  curl -sS \
    --connect-timeout 2 \
    --max-time 15 \
    -o "$TMP/tools.body" \
    -w '%{http_code}' \
    "${HEADERS[@]}" \
    --data-binary \
    '{"jsonrpc":"2.0","id":102,"method":"tools/list","params":{}}' \
    "$URL"
)"

echo "tools_list_http=$CODE"

[[ "$CODE" == 200 ]] || {
  echo 'FATAL: tools/list failed'
  exit 30
}

python3 - "$TMP/tools.body" <<'PY'
import json
import sys
from collections import Counter

raw = open(
    sys.argv[1],
    encoding='utf-8',
    errors='replace'
).read().strip()

if raw.startswith('data:'):
    raw = ''.join(
        line[5:].strip()
        for line in raw.splitlines()
        if line.startswith('data:')
    )

obj = json.loads(raw)

if obj.get('error'):
    raise SystemExit(
        'FATAL: tools/list JSON-RPC error: ' +
        json.dumps(obj['error'], ensure_ascii=False)
    )

tools = (obj.get('result') or {}).get('tools') or []

names = [
    t.get('name')
    for t in tools
    if isinstance(t, dict)
    and isinstance(t.get('name'), str)
]

counts = Counter(names)

print(f'tool_count={len(names)}')
print(f'unique_tool_count={len(counts)}')

duplicates = [
    (name, count)
    for name, count in counts.items()
    if count > 1
]

if duplicates:
    for name, count in sorted(duplicates):
        print(f'DUPLICATE_TOOL name={name} count={count}')
    raise SystemExit('FATAL: duplicate MCP tools')

expected = {
    'central_offsite_enable_request',
    'central_offsite_enable_apply',
    'central_offsite_enable_status',
    'health_check',
}

missing = sorted(expected - set(names))

if missing:
    print('missing=' + ','.join(missing))
    raise SystemExit('FATAL: required tools missing')

print('TOOL_UNIQUENESS=PASS')
PY

echo '=== health_check ==='

CODE="$(
  curl -sS \
    --connect-timeout 2 \
    --max-time 15 \
    -o "$TMP/health.body" \
    -w '%{http_code}' \
    "${HEADERS[@]}" \
    --data-binary \
    '{"jsonrpc":"2.0","id":103,"method":"tools/call","params":{"name":"health_check","arguments":{}}}' \
    "$URL"
)"

echo "health_call_http=$CODE"

[[ "$CODE" == 200 ]] || {
  echo 'FATAL: health_check HTTP failure'
  exit 40
}

python3 - "$TMP/health.body" <<'PY'
import json
import sys

raw=open(
    sys.argv[1],
    encoding='utf-8',
    errors='replace'
).read().strip()

if raw.startswith('data:'):
    raw=''.join(
        line[5:].strip()
        for line in raw.splitlines()
        if line.startswith('data:')
    )

obj=json.loads(raw)

if obj.get('error'):
    raise SystemExit(
        'FATAL: health_check JSON-RPC error: ' +
        json.dumps(obj['error'], ensure_ascii=False)
    )

print('HEALTH_CHECK_CALL=PASS')
PY

echo '============================================'
echo 'MCP_RUNTIME_PREFLIGHT=PASS'
echo "candidate_port=$PORT"
echo '============================================'
