#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C
EXPECTED_HELPER=540d3e5c23983ed6ff3969e92fc00c9445d6ad0daef5534572eda152ad102583
EXPECTED_PAYLOAD=42ddf3e5e414089b3e5ebe73af94d2f89aee368bb794db9f471723cc78f0e97b
HELPER=/usr/local/sbin/prhm-node1-ssl-helper-v1.sh
PAYLOAD=/opt/prhm-host-actions/payloads/prhm-edge-cert-deploy-v2.sh
MARKER=prhm-host-actions-v2-node1-ssl
AUTH=/root/.ssh/authorized_keys

[[ $# -eq 3 ]] || { echo 'ERROR=invalid_arguments' >&2; exit 64; }
H_TMP=$1; P_TMP=$2; PUB_TMP=$3
for p in "$H_TMP" "$P_TMP" "$PUB_TMP"; do [[ "$p" =~ ^/tmp/prhm-host-actions-v2-ssl-[A-Za-z0-9._-]+$ ]] || { echo 'ERROR=invalid_temp_path' >&2; exit 64; }; [[ -f "$p" && ! -L "$p" ]] || { echo 'ERROR=temp_file_invalid' >&2; exit 10; }; done
[[ "$(hostname)" == node1.prhm.ir ]] || { echo 'ERROR=hostname_mismatch' >&2; exit 11; }
[[ ! -e "$HELPER" ]] || { echo 'ERROR=helper_target_exists' >&2; exit 12; }
[[ ! -e "$PAYLOAD" ]] || { echo 'ERROR=payload_target_exists' >&2; exit 13; }
[[ "$(sha256sum -- "$H_TMP" | awk '{print $1}')" == "$EXPECTED_HELPER" ]] || { echo 'ERROR=helper_sha_mismatch' >&2; exit 14; }
[[ "$(sha256sum -- "$P_TMP" | awk '{print $1}')" == "$EXPECTED_PAYLOAD" ]] || { echo 'ERROR=payload_sha_mismatch' >&2; exit 15; }
bash -n "$H_TMP" || { echo 'ERROR=helper_syntax_invalid' >&2; exit 16; }
bash -n "$P_TMP" || { echo 'ERROR=payload_syntax_invalid' >&2; exit 17; }
pub=$(tr -d '\r\n' < "$PUB_TMP")
[[ "$pub" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+([[:space:]][A-Za-z0-9._@+-]+)?$ ]] || { echo 'ERROR=public_key_invalid' >&2; exit 18; }
if [[ -f "$AUTH" ]] && grep -Fq "$MARKER" "$AUTH"; then echo 'ERROR=authorized_marker_exists' >&2; exit 19; fi

helper_created=0; payload_created=0; auth_created=0; auth_file_created=0
rollback(){
  rc=$?
  set +e
  if (( auth_created==1 )) && [[ -f "$AUTH" ]]; then
    tmp="${AUTH}.rollback.$$"; grep -Fv "$MARKER" "$AUTH" > "$tmp"; chmod 600 "$tmp"; chown 0:0 "$tmp"; mv -f "$tmp" "$AUTH"
  fi
  (( helper_created==0 )) || rm -f -- "$HELPER"
  (( payload_created==0 )) || rm -f -- "$PAYLOAD"
  if (( auth_file_created==1 )) && [[ -f "$AUTH" && ! -s "$AUTH" ]]; then rm -f "$AUTH"; fi
  rmdir /opt/prhm-host-actions/payloads 2>/dev/null || true
  rmdir /opt/prhm-host-actions 2>/dev/null || true
  echo 'PROVISION_ROLLBACK=YES' >&2
  exit "$rc"
}
trap rollback ERR
mkdir -p /opt/prhm-host-actions/payloads /root/.ssh
chmod 700 /root/.ssh
if [[ ! -e "$AUTH" ]]; then install -m 600 /dev/null "$AUTH"; auth_file_created=1; fi
chmod 600 "$AUTH"; chown 0:0 "$AUTH"
install -m 0755 -- "$H_TMP" "$HELPER"; chown 0:0 "$HELPER"; helper_created=1
install -m 0755 -- "$P_TMP" "$PAYLOAD"; chown 0:0 "$PAYLOAD"; payload_created=1
line="command=\"$HELPER\",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding $pub $MARKER"
printf '%s\n' "$line" >> "$AUTH"; auth_created=1
[[ "$(grep -Fc "$MARKER" "$AUTH")" -eq 1 ]] || { echo 'ERROR=authorized_marker_cardinality' >&2; false; }
[[ "$(sha256sum -- "$HELPER" | awk '{print $1}')" == "$EXPECTED_HELPER" ]] || { echo 'ERROR=installed_helper_sha_mismatch' >&2; false; }
[[ "$(sha256sum -- "$PAYLOAD" | awk '{print $1}')" == "$EXPECTED_PAYLOAD" ]] || { echo 'ERROR=installed_payload_sha_mismatch' >&2; false; }
trap - ERR
printf 'NODE1_PROVISION=OK\nHELPER_SHA256=%s\nPAYLOAD_SHA256=%s\nAUTHORIZED_MARKER=%s\n' "$EXPECTED_HELPER" "$EXPECTED_PAYLOAD" "$MARKER"
