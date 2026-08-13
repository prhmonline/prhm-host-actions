#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C
ACTIVE=/usr/local/sbin/prhm-edge-cert-deploy
HELPER=/usr/local/sbin/prhm-node1-ssl-helper-v1.sh
PAYLOAD=/opt/prhm-host-actions/payloads/prhm-edge-cert-deploy-v2.sh
MARKER=prhm-host-actions-v2-node1-ssl

[[ "$(hostname)" == node1.prhm.ir ]] || { echo 'ERROR=hostname_mismatch' >&2; exit 10; }
[[ -f "$ACTIVE" ]] || { echo 'ERROR=active_deploy_missing' >&2; exit 11; }
bash -n "$ACTIVE" || { echo 'ERROR=active_deploy_syntax_invalid' >&2; exit 12; }
for x in openssl sha256sum awk base64 nginx systemctl install; do command -v "$x" >/dev/null 2>&1 || { echo "ERROR=missing_command:$x" >&2; exit 13; }; done
[[ ! -e "$HELPER" ]] || { echo 'ERROR=helper_already_exists' >&2; exit 20; }
[[ ! -e "$PAYLOAD" ]] || { echo 'ERROR=payload_already_exists' >&2; exit 21; }
if [[ -f /root/.ssh/authorized_keys ]] && grep -Fq "$MARKER" /root/.ssh/authorized_keys; then echo 'ERROR=authorized_marker_already_exists' >&2; exit 22; fi
active_sha=$(sha256sum -- "$ACTIVE" | awk '{print $1}')
host_blob=$(awk 'NF>=2 {print $2; exit}' /etc/ssh/ssh_host_ecdsa_key.pub)
[[ -n "$host_blob" ]] || { echo 'ERROR=host_key_missing' >&2; exit 23; }
host_sha=$(printf '%s' "$host_blob" | base64 -d | sha256sum | awk '{print $1}')
[[ "$active_sha" =~ ^[a-f0-9]{64}$ ]] || { echo 'ERROR=active_sha_invalid' >&2; exit 24; }
[[ "$host_sha" =~ ^[a-f0-9]{64}$ ]] || { echo 'ERROR=host_sha_invalid' >&2; exit 25; }
printf 'NODE1_BOOTSTRAP_PREFLIGHT=OK\nACTIVE_SHA256=%s\nHOST_KEY_SHA256=%s\n' "$active_sha" "$host_sha"
