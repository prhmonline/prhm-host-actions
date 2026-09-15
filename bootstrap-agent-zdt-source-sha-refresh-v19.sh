#!/bin/bash
set -Eeuo pipefail

[ "$#" -eq 0 ] || { echo 'unexpected_arguments' >&2; exit 64; }

TARGET='/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-existing-topology-rolling-refresh-v1.js'
OLD_ACTION_SHA='0fd63f7f8fe346ced5fbbfa3a7a4bc96253e498528934aaa3c7232e986b832bf'
OLD_API_SHA='5878fb592d8afcac571faa710e35811e462d4b98a2c120104b1eaf3ec1644001'
NEW_API_SHA='0cafe4ec6ad9471f3fdae65e3d2fa93bf349bfdeb5caf99ab03a18a5d3ece556'
BACKUP_ROOT='/var/backups/prhm-agent-zdt-source-sha-refresh-v19'
PRHM_NODE='/usr/local/bin/prhm-node'

fail(){ echo "$1" >&2; exit 1; }

[ -f "$TARGET" ] && [ ! -L "$TARGET" ] || fail 'target_not_regular'
CURRENT_SHA="$(sha256sum "$TARGET" | awk '{print $1}')"
[ "$CURRENT_SHA" = "$OLD_ACTION_SHA" ] || fail 'old_action_sha_mismatch'

OLD_COUNT="$(grep -F -o -- "$OLD_API_SHA" "$TARGET" | wc -l | tr -d ' ')"
[ "$OLD_COUNT" = '1' ] || fail 'old_api_sha_count_mismatch'
if grep -F -q -- "$NEW_API_SHA" "$TARGET"; then fail 'new_api_sha_already_present'; fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p -m 0700 "$BACKUP_ROOT"
BACKUP="$BACKUP_ROOT/rolling-refresh-v1.$STAMP.$OLD_ACTION_SHA.bak"
cp -p -- "$TARGET" "$BACKUP"
[ "$(sha256sum "$BACKUP" | awk '{print $1}')" = "$OLD_ACTION_SHA" ] || fail 'backup_sha_mismatch'

DIR="$(dirname "$TARGET")"
BASE="$(basename "$TARGET")"
TMP="$DIR/.${BASE}.source-sha-refresh.$$.$RANDOM.tmp"
rollback(){
  if [ -f "$BACKUP" ]; then
    cp -p -- "$BACKUP" "$TMP.rollback"
    mv -f -- "$TMP.rollback" "$TARGET"
  fi
}
trap 'rc=$?; rm -f -- "$TMP" "$TMP.rollback" 2>/dev/null || true; if [ "$rc" -ne 0 ]; then rollback || true; fi; exit "$rc"' EXIT

awk -v old="$OLD_API_SHA" -v new="$NEW_API_SHA" '{gsub(old,new); print}' "$TARGET" > "$TMP"
chmod --reference="$TARGET" "$TMP"
chown --reference="$TARGET" "$TMP"

[ "$(grep -F -o -- "$OLD_API_SHA" "$TMP" | wc -l | tr -d ' ')" = '0' ] || fail 'old_api_sha_remains_after_refresh'
[ "$(grep -F -o -- "$NEW_API_SHA" "$TMP" | wc -l | tr -d ' ')" = '1' ] || fail 'new_api_sha_postcondition_failed'
"$PRHM_NODE" --check "$TMP" >/dev/null

mv -f -- "$TMP" "$TARGET"
"$PRHM_NODE" --check "$TARGET" >/dev/null
[ "$(grep -F -o -- "$NEW_API_SHA" "$TARGET" | wc -l | tr -d ' ')" = '1' ] || fail 'postcommit_new_api_sha_verify_failed'

trap - EXIT
printf '{"ok":true,"action":"agent_zdt_existing_topology_rolling_refresh_source_sha_refresh_v19","target":"%s","old_action_sha256":"%s","new_action_sha256":"%s","backup":"%s","production_application_mutation":false,"database_mutation":false}\n' "$TARGET" "$OLD_ACTION_SHA" "$(sha256sum "$TARGET" | awk '{print $1}')" "$BACKUP"
