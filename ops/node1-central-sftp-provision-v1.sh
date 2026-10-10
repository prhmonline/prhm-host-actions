#!/usr/bin/env bash
# NODE1-ONLY root provisioning, fixed service identity; run via SSH from pinned Git checkout.
# Invoked with one public Ed25519 key argument. No credentials/private key in Git.
set -Eeuo pipefail
umask 077
if [[ $# != 2 || "$1" != --apply ]];then echo 'LEVEL4_ONLY_FIXED_PROVISIONER' >&2;exit 2;fi
PUB="$2"
[[ "$PUB" =~ ^ssh-ed25519[[:space:]]+[A-Za-z0-9+/=]+([[:space:]][A-Za-z0-9@._-]+)?$ ]] || { echo 'INVALID_PUBLIC_KEY';exit 3; }
SSHD=/etc/ssh/sshd_config
KEYS=/etc/ssh/prhmbackup_authorized_keys
ROOT=/srv/prhm-sftp
REPO="$ROOT/repo/central-production"
MARKER='# PRHM_NODE1_CENTRAL_RESTIC_SFTP_V1'
BACKUP="/var/backups/prhm-node1-sshd-preimage-$(date -u +%Y%m%dT%H%M%SZ)-$$.conf"
[[ "$(id -u)" = 0 ]] || { echo 'ROOT_REQUIRED';exit 4; }
[[ "$(hostname)" = server1.prhm.ir ]] || { echo 'UNEXPECTED_NODE1_HOST';exit 5; }
/usr/sbin/sshd -t
test "$(systemctl is-active sshd)" = active
[[ ! -e "$KEYS" && ! -e "$ROOT" ]] || { echo 'PROVISION_TARGET_EXISTS_REFUSING';exit 6; }
! id prhmbackup >/dev/null 2>&1 || { echo 'BACKUP_ACCOUNT_EXISTS_REFUSING';exit 7; }
! grep -Fq "$MARKER" "$SSHD" || { echo 'SSHD_BLOCK_EXISTS_REFUSING';exit 8; }
test "$(stat -c %a "$SSHD")" = 600
cp -p "$SSHD" "$BACKUP"
test "$(sha256sum "$SSHD" | cut -d' ' -f1)" = "$(sha256sum "$BACKUP" | cut -d' ' -f1)"
MUTATED=0
rollback(){
 local rc=$?
 if [[ $rc != 0 && $MUTATED = 1 ]];then
   cp -p "$BACKUP" "$SSHD"
   /usr/sbin/sshd -t || true
   systemctl reload sshd || true
   rm -f -- "$KEYS"
   if id prhmbackup >/dev/null 2>&1;then userdel prhmbackup || true;fi
   rmdir "$REPO" "$ROOT/repo" "$ROOT" 2>/dev/null || true
   echo "NODE1_PROVISION_ROLLBACK=ATTEMPTED preimage=$BACKUP" >&2
 fi
}
trap rollback EXIT
MUTATED=1
useradd --user-group --no-create-home --home-dir /repo --shell /sbin/nologin prhmbackup
passwd --lock prhmbackup >/dev/null 2>&1 || true
install -d -o root -g root -m 0755 "$ROOT" "$ROOT/repo"
install -d -o prhmbackup -g prhmbackup -m 0700 "$REPO"
printf '%s\n' "$PUB" >"$KEYS"
chown root:prhmbackup "$KEYS";chmod 0640 "$KEYS"
cat >>"$SSHD" <<'EOF'

# PRHM_NODE1_CENTRAL_RESTIC_SFTP_V1
Match User prhmbackup
    ChrootDirectory /srv/prhm-sftp
    ForceCommand internal-sftp -d /repo
    AuthorizedKeysFile /etc/ssh/prhmbackup_authorized_keys
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitTTY no
    AllowTcpForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTunnel no
EOF
/usr/sbin/sshd -t
CONF="$(/usr/sbin/sshd -T -C user=prhmbackup,host=server1.prhm.ir,addr=127.0.0.1)"
grep -q '^forcecommand internal-sftp -d /repo$' <<<"$CONF"
grep -q '^chrootdirectory /srv/prhm-sftp$' <<<"$CONF"
grep -q '^passwordauthentication no$' <<<"$CONF"
grep -q '^allowtcpforwarding no$' <<<"$CONF"
grep -q '^permittty no$' <<<"$CONF"
systemctl reload sshd
test "$(systemctl is-active sshd)" = active
test "$(stat -c '%U:%a' "$REPO")" = prhmbackup:700
test "$(stat -c '%U:%a' "$ROOT")" = root:755
echo 'NODE1_RESTRICTED_SFTP_PROVISION=PASS'
echo "SSHD_PREIMAGE_BACKUP=$BACKUP"
echo "SSHD_NEW_SHA256=$(sha256sum "$SSHD" | cut -d' ' -f1)"
MUTATED=0
