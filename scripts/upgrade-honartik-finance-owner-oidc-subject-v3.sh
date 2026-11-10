#!/usr/bin/env bash
# Finance owner identity-only v3: exact GitHub OIDC subject compatibility.
# Never executes a finance release, changes sudo, alters the wallet or
# deletes a pending/inbox/consumed proof.
set -Eeuo pipefail
umask 077
[[ "$EUID" -eq 0 && "$(hostname -f)" == 'prhm-production.prhm.ir' ]] || {
 echo 'FINANCE_SUBJECT_UPGRADE=BLOCKED root_host';exit 11;
}
PIN="$INSTALL_SOURCE_SHA"
PREV=133d51f0b9a4d6cb2c8385414a3b5f400ba26003
OLD_WORKFLOW=10efc3fd5ca274ca718204dc821ccae8531a8599
[[ "$PIN" =~ ^[a-f0-9]{40}$ && "$PIN" != "$PREV" ]] || exit 12
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
[[ -d "$ROOT/.git" &&
   "$(git -c safe.directory="$ROOT" -C "$ROOT" rev-parse HEAD)" == "$PIN" &&
   -z "$(git -c safe.directory="$ROOT" -C "$ROOT" status --porcelain --untracked-files=all)" ]] || exit 13
STATE=/var/lib/prhm-honartik-finance-owner
CFG=/etc/prhm-honartik-finance-owner/identity.json
PARENT=/opt/prhm-honartik-finance-owner/releases
OLD="$PARENT/$PREV"
TARGET="$PARENT/$PIN"
[[ -d "$OLD" && ! -e "$TARGET" && ! -L "$TARGET" &&
   -f "$CFG" && ! -L "$CFG" ]] || exit 14
test "$(sha256sum "$OLD/honartik-finance-owner-oidc-identity-v1.cjs" | awk '{print $1}')" = 552f1d5bbedf298308ff217764235d273d3b66af799986861ae40646fb82f601
test "$(sha256sum "$OLD/honartik-finance-owner-host-verifier-v1.cjs" | awk '{print $1}')" = 335cc47140dd7b417551c3a6a49866df04d07eef9a0524309456cd0d9d08efb0
for d in "$STATE" "$STATE/pending" "$STATE/inbox" "$STATE/consumed" /etc/prhm-honartik-finance-owner;do
 [[ -d "$d" && ! -L "$d" ]] || exit 15
 test "$(stat -Lc '%u:%g:%a' "$d")" = '0:0:700'
done
test "$(stat -Lc '%u:%g:%a' "$CFG")" = '0:0:600'
# Do not rotate expected SHA while any issued challenge may still be valid.
python3 - "$STATE/pending" <<'PY'
import json, pathlib,sys,time
now=int(time.time())
for f in pathlib.Path(sys.argv[1]).iterdir():
 if not f.is_file() or f.is_symlink(): raise SystemExit('BLOCKED:pending_path')
 try:
  v=json.loads(f.read_text())
  if v.get('expires_at',now+1)>now:raise SystemExit('BLOCKED:unexpired_pending_challenge')
 except (ValueError,UnicodeDecodeError):
  raise SystemExit('BLOCKED:unreadable_pending_challenge')
print('ACTIVE_OWNER_CHALLENGES=0')
PY
RECEIPTS_BEFORE=$(find "$STATE/consumed" -maxdepth 1 -type f | wc -l)
FILES='honartik-finance-owner-host-verifier-v1.cjs
honartik-finance-owner-oidc-identity-v1.cjs
honartik-finance-owner-once-fence-v1.cjs
universal-owner-oidc-sealed-transport-v1.cjs
universal-owner-oidc-recovery-gate-v1.cjs
universal-installer-backup-only-native-contract-v1.cjs'
for rel in $FILES;do
 [[ -f "$ROOT/$rel" && ! -L "$ROOT/$rel" ]] || exit 16
 /usr/bin/node --check "$ROOT/$rel" >/dev/null
done
/usr/bin/node --test "$ROOT/test-honartik-finance-owner-oidc-v1.cjs" >/dev/null
/usr/bin/node --test "$ROOT/test-honartik-finance-owner-host-verifier-v1.cjs" >/dev/null
# Verify prior immutable scope, then atomically repin AFTER source tests.
node - "$CFG" "$PREV" "$OLD_WORKFLOW" <<'NODE'
const fs=require('fs');
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(Object.keys(c).sort().join(',')!=='expected_workflow_sha,installed_source_sha,operation,production_base_sha,source_sha' ||
 c.installed_source_sha!==process.argv[3] ||
 c.expected_workflow_sha!==process.argv[4] ||
 c.operation!=='honartik_back.production.finance_release' ||
 c.production_base_sha!=='4ac602e874a128c3328f27f3dab473857512cdbf' ||
 c.source_sha!=='d1a64e640c9c2cf4788d55566c17728be5813941')
 process.exit(23);
NODE
test "$(git -C /home/honartik/domains/dashboard.honartik.ir/public_html rev-parse HEAD)" = 4ac602e874a128c3328f27f3dab473857512cdbf
test ! -e /etc/honartik/iticket-wallet.enabled
test ! -e /etc/honartik/iticket-auto-compensation.enabled
install -d -m 0755 -o root -g root "$TARGET"
for rel in $FILES;do
 install -m 0644 -o root -g root "$ROOT/$rel" "$TARGET/$rel"
 cmp -s "$ROOT/$rel" "$TARGET/$rel" || exit 17
done
# Backup existing config for exact-audit rollback; never modify receipts.
AUDIT=/root/prhm-dev/audit
[[ -d "$AUDIT" && "$(stat -Lc '%u' "$AUDIT")" == 0 ]] || exit 18
BACKUP=$(mktemp "$AUDIT/honartik-finance-subject-config.XXXXXXXX")
chmod 0600 "$BACKUP"
cp -p "$CFG" "$BACKUP"
node - "$CFG" "$PIN" <<'NODE'
const fs=require('fs'),path=require('path');
const file=process.argv[2],pin=process.argv[3];
const c=JSON.parse(fs.readFileSync(file));
c.installed_source_sha=pin;
c.expected_workflow_sha=pin;
const temp=file+'.subject-next';
const fd=fs.openSync(temp,fs.constants.O_CREAT|fs.constants.O_EXCL|
  fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
try{fs.writeFileSync(fd,JSON.stringify(c)+'\n');fs.fsyncSync(fd)}
finally{fs.closeSync(fd)}
fs.renameSync(temp,file);
const d=fs.openSync(path.dirname(file),fs.constants.O_DIRECTORY|fs.constants.O_RDONLY);
try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
NODE
test "$(stat -Lc '%u:%g:%a' "$CFG")" = '0:0:600'
test "$(find "$STATE/consumed" -maxdepth 1 -type f | wc -l)" = "$RECEIPTS_BEFORE"
echo "FINANCE_OWNER_SUBJECT_VERIFIER_UPGRADE=PASS sha=$PIN"
echo "PREVIOUS_CONFIG_BACKUP=$BACKUP"
echo 'OWNER_PROOFS_IN_LEDGER_PRESERVED=TRUE'
echo 'FINANCE_RELEASE_AUTHORIZED=FALSE'
echo 'PAYMENT_OR_APP_MUTATED=FALSE'
