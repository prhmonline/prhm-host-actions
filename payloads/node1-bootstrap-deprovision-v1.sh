#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C
EXPECTED_HELPER=540d3e5c23983ed6ff3969e92fc00c9445d6ad0daef5534572eda152ad102583
EXPECTED_PAYLOAD=42ddf3e5e414089b3e5ebe73af94d2f89aee368bb794db9f471723cc78f0e97b
HELPER=/usr/local/sbin/prhm-node1-ssl-helper-v1.sh
PAYLOAD=/opt/prhm-host-actions/payloads/prhm-edge-cert-deploy-v2.sh
MARKER=prhm-host-actions-v2-node1-ssl
AUTH=/root/.ssh/authorized_keys
[[ $# -eq 0 ]] || { echo 'ERROR=arguments_not_allowed' >&2; exit 64; }
[[ "$(hostname)" == node1.prhm.ir ]] || { echo 'ERROR=hostname_mismatch' >&2; exit 10; }
if [[ -e "$HELPER" ]]; then [[ -f "$HELPER" && ! -L "$HELPER" ]] || { echo 'ERROR=helper_not_regular' >&2; exit 11; }; [[ "$(sha256sum -- "$HELPER" | awk '{print $1}')" == "$EXPECTED_HELPER" ]] || { echo 'ERROR=helper_changed_refuse_delete' >&2; exit 12; }; fi
if [[ -e "$PAYLOAD" ]]; then [[ -f "$PAYLOAD" && ! -L "$PAYLOAD" ]] || { echo 'ERROR=payload_not_regular' >&2; exit 13; }; [[ "$(sha256sum -- "$PAYLOAD" | awk '{print $1}')" == "$EXPECTED_PAYLOAD" ]] || { echo 'ERROR=payload_changed_refuse_delete' >&2; exit 14; }; fi
if [[ -f "$AUTH" ]]; then
  n=$(grep -Fc "$MARKER" "$AUTH" || true); [[ "$n" -le 1 ]] || { echo 'ERROR=authorized_marker_duplicate' >&2; exit 15; }
  if [[ "$n" -eq 1 ]]; then tmp="${AUTH}.rollback.$$"; grep -Fv "$MARKER" "$AUTH" > "$tmp"; chmod 600 "$tmp"; chown 0:0 "$tmp"; mv -f "$tmp" "$AUTH"; fi
fi
rm -f -- "$HELPER" "$PAYLOAD"
rmdir /opt/prhm-host-actions/payloads 2>/dev/null || true
rmdir /opt/prhm-host-actions 2>/dev/null || true
printf 'NODE1_DEPROVISION=OK\n'
