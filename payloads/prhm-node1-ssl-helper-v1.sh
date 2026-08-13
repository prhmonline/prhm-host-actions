#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

ACTIVE=/usr/local/sbin/prhm-edge-cert-deploy
PAYLOAD=/opt/prhm-host-actions/payloads/prhm-edge-cert-deploy-v2.sh
BACKUPS=/var/backups/prhm-host-actions-node1
HELPER_VERSION=prhm.node1.ssl-helper.v1
SHA_RE='^[a-f0-9]{64}$'

sha_file(){ sha256sum -- "$1" | awk '{print $1}'; }
fail(){ printf 'ERROR=%s\n' "$1" >&2; exit "${2:-1}"; }

observe(){
  [[ -f "$ACTIVE" ]] || fail active_script_missing 10
  [[ -f "$PAYLOAD" ]] || fail payload_missing 11
  local active_sha payload_sha
  active_sha=$(sha_file "$ACTIVE")
  payload_sha=$(sha_file "$PAYLOAD")
  [[ "$active_sha" =~ $SHA_RE ]] || fail active_sha_invalid 12
  [[ "$payload_sha" =~ $SHA_RE ]] || fail payload_sha_invalid 13
  printf 'HELPER_VERSION=%s\nACTIVE_SHA256=%s\nPAYLOAD_SHA256=%s\n' "$HELPER_VERSION" "$active_sha" "$payload_sha"
}

preflight(){
  local expected=$1 payload_expected=$2
  [[ "$expected" =~ $SHA_RE ]] || fail invalid_expected_sha 20
  [[ "$payload_expected" =~ $SHA_RE ]] || fail invalid_payload_sha 21
  [[ -f "$ACTIVE" && -f "$PAYLOAD" ]] || fail required_file_missing 22
  local actual payload_actual
  actual=$(sha_file "$ACTIVE")
  payload_actual=$(sha_file "$PAYLOAD")
  [[ "$actual" == "$expected" ]] || fail "active_sha_mismatch:$actual" 23
  [[ "$payload_actual" == "$payload_expected" ]] || fail "payload_sha_mismatch:$payload_actual" 24
  bash -n "$PAYLOAD" || fail payload_bash_syntax_invalid 25
  "$PAYLOAD" --preflight
  printf 'ACTION_PREFLIGHT=OK\nACTIVE_SHA256=%s\nPAYLOAD_SHA256=%s\n' "$actual" "$payload_actual"
}

apply(){
  local expected=$1 payload_expected=$2
  preflight "$expected" "$payload_expected" >/tmp/prhm-host-action-preflight.$$
  mkdir -p "$BACKUPS"
  chmod 700 "$BACKUPS"
  local stamp backup tmp actual_after
  stamp=$(date +%Y%m%d-%H%M%S)-$$
  backup="$BACKUPS/prhm-edge-cert-deploy-$stamp-$expected.bak"
  cp -a -- "$ACTIVE" "$backup"
  tmp="${ACTIVE}.host-action-${stamp}.tmp"
  install -m 0755 -- "$PAYLOAD" "$tmp"
  chown 0:0 "$tmp"
  trap 'rc=$?; rm -f -- "$tmp" /tmp/prhm-host-action-preflight.$$; if [[ -f "$backup" ]]; then cp -a -- "$backup" "$ACTIVE"; fi; echo ROLLBACK_PERFORMED=YES >&2; exit $rc' ERR
  mv -f -- "$tmp" "$ACTIVE"
  bash -n "$ACTIVE"
  "$ACTIVE" --preflight
  actual_after=$(sha_file "$ACTIVE")
  [[ "$actual_after" == "$payload_expected" ]] || fail "post_install_sha_mismatch:$actual_after" 31
  trap - ERR
  rm -f /tmp/prhm-host-action-preflight.$$
  printf 'ACTION_APPLIED=YES\nOLD_SHA256=%s\nNEW_SHA256=%s\nBACKUP=%s\nROLLBACK_PERFORMED=NO\n' "$expected" "$actual_after" "$backup"
}

cmd=${SSH_ORIGINAL_COMMAND:-}
case "$cmd" in
  ssl-observe)
    observe
    ;;
  ssl-preflight\ *)
    read -r verb expected payload extra <<<"$cmd"
    [[ "$verb" == ssl-preflight && -z "${extra:-}" && -n "${expected:-}" && -n "${payload:-}" ]] || fail invalid_preflight_command 64
    preflight "$expected" "$payload"
    ;;
  ssl-apply\ *)
    read -r verb expected payload extra <<<"$cmd"
    [[ "$verb" == ssl-apply && -z "${extra:-}" && -n "${expected:-}" && -n "${payload:-}" ]] || fail invalid_apply_command 64
    apply "$expected" "$payload"
    ;;
  *)
    fail command_not_allowed 64
    ;;
esac
