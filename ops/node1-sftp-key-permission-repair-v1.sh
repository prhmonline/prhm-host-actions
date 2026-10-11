#!/usr/bin/env bash
# Node1 one-shot root authorized-keys read permission correction.
# No alteration to sshd_config, account, public-key content, or other services.
set -Eeuo pipefail
[[ $# -eq 1 && "$1" == --apply ]] || { echo 'EXPLICIT_FIXED_MODE_REQUIRED';exit 2; }
[[ "$(hostname)" == server1.prhm.ir ]] || { echo 'UNEXPECTED_HOST';exit 3; }
F=/etc/ssh/prhmbackup_authorized_keys
[[ "$(stat -c '%U:%G:%a' "$F")" == root:root:600 ]] || { echo 'UNEXPECTED_AUTHORIZED_KEYS_PREIMAGE';exit 4; }
id prhmbackup >/dev/null
test "$(systemctl is-active sshd)" = active
[[ "$(/usr/sbin/sshd -T -C user=prhmbackup,host=server1.prhm.ir,addr=127.0.0.1 | grep '^authorizedkeysfile ')" == 'authorizedkeysfile /etc/ssh/prhmbackup_authorized_keys' ]]
chgrp prhmbackup "$F"
chmod 0640 "$F"
test "$(stat -c '%U:%G:%a' "$F")" = root:prhmbackup:640
/usr/sbin/sshd -t
echo 'NODE1_AUTHORIZED_PUBLIC_KEY_READ_PERMISSION=PASS'
