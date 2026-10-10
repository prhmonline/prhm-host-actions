#!/usr/bin/env bash
# CENTRAL-ONLY fixed client provisioning, no host changes outside /etc/prhm-backup/node1.
# Existing trust anchor for Node1 is the already pinned ECDSA key in /root/.ssh/known_hosts.
set -Eeuo pipefail
umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
if [[ $# != 1 || "$1" != --apply ]];then echo 'FIXED_CLIENT_PROVISION_ONLY';exit 2;fi
test "$(hostname)" = prhm-production.prhm.ir || { echo 'UNEXPECTED_CENTRAL_HOST';exit 3; }
ROOT=/etc/prhm-backup/node1
IDENTITY="$ROOT/id_ed25519"
KNOWN="$ROOT/known_hosts"
CONFIG="$ROOT/ssh_config"
PASS="$ROOT/restic.password"
TRUST=/root/.ssh/known_hosts
test -s "$TRUST"
for f in "$IDENTITY" "$KNOWN" "$CONFIG" "$PASS";do
 [[ ! -e "$f" ]] || { echo 'CLIENT_PROVISION_TARGET_EXISTS_REFUSING' >&2;exit 4; }
done
install -d -o root -g root -m 0700 "$ROOT"
cleanup(){
 rc=$?
 if [[ "$rc" != 0 ]];then
   rm -f "$IDENTITY" "$IDENTITY.pub" "$KNOWN" "$CONFIG" "$PASS"
   echo 'CLIENT_PROVISION_FAILED_AND_CLEARED' >&2
 fi
}
trap cleanup EXIT
SCAN="$(timeout 10 ssh-keyscan -T 6 -t ecdsa 185.191.76.138 2>/dev/null)" || { echo 'HOSTKEY_SCAN_FAIL';exit 5; }
export SCAN
python3 - "$TRUST" "$KNOWN" <<'PY'
import os,sys,subprocess
known=sys.argv[1];out=sys.argv[2]
result=subprocess.run(['ssh-keygen','-F','185.191.76.138','-f',known],text=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
assert result.returncode==0
trusted=set(' '.join(x.split()[1:3]) for x in result.stdout.splitlines() if x and not x.startswith('#') and len(x.split())>=3)
scan=[]
for line in os.environ['SCAN'].splitlines():
 parts=line.split()
 if len(parts)==3 and parts[0]=='185.191.76.138' and parts[1].startswith('ecdsa-'):
  if ' '.join(parts[1:3]) in trusted:scan.append(line)
assert len(scan)==1,'HOST_KEY_PIN_MISMATCH'
open(out,'w').write(scan[0]+'\n')
print('NODE1_HOSTKEY_PREEXISTING_TRUST_MATCH=PASS')
PY
chown root:root "$KNOWN";chmod 0600 "$KNOWN"
ssh-keygen -q -t ed25519 -a 64 -N '' -f "$IDENTITY" -C prhm-node1-central-backup >/dev/null
chmod 0600 "$IDENTITY" "$IDENTITY.pub"
openssl rand -hex 48 > "$PASS"
chmod 0600 "$PASS"
cat >"$CONFIG" <<'EOF'
Host prhm-node1-backup
    HostName 185.191.76.138
    User prhmbackup
    Port 22
    IdentityFile /etc/prhm-backup/node1/id_ed25519
    IdentitiesOnly yes
    UserKnownHostsFile /etc/prhm-backup/node1/known_hosts
    GlobalKnownHostsFile /dev/null
    StrictHostKeyChecking yes
    BatchMode yes
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PreferredAuthentications publickey
    ConnectTimeout 8
    ServerAliveInterval 30
    ServerAliveCountMax 2
    ForwardAgent no
    ClearAllForwardings yes
    RequestTTY no
EOF
chmod 0600 "$CONFIG"
ssh -G -F "$CONFIG" prhm-node1-backup | grep -q '^user prhmbackup$'
ssh -G -F "$CONFIG" prhm-node1-backup | grep -q '^stricthostkeychecking true$'
for f in "$IDENTITY" "$KNOWN" "$CONFIG" "$PASS";do
 test "$(stat -c '%u:%g:%a' "$f")" = 0:0:600
done
echo 'CENTRAL_SFTP_CLIENT_CONFIG=PASS'
echo 'RESTIC_PASSWORD_RECOVERY_COPY_REQUIRED=YES'
