#!/usr/bin/env bash
# Narrow root-only identity-verifier v1 -> v2 upgrade for PUBLIC GitHub API reads.
# Never resets consumed receipts or installs generic root/production executor.
set -Eeuo pipefail
umask 077
[[ "$EUID" -eq 0 && "$(hostname -f)" == prhm-production.prhm.ir ]] || {
  echo 'FINANCE_IDENTITY_UPGRADE=BLOCKED reason=root_host_required'; exit 11;
}
PIN="$INSTALL_SOURCE_SHA"
PREV=17b8b4cbb54928ac374a9bd8a62a47fd417f9754
BASE=/opt/prhm-honartik-finance-owner
STATE=/var/lib/prhm-honartik-finance-owner
CONFIG=/etc/prhm-honartik-finance-owner/identity.json
TARGET="$BASE/releases/$PIN"
OLD="$BASE/releases/$PREV"
[[ "$PIN" =~ ^[a-f0-9]{40}$ && "$PIN" != "$PREV" ]] || {
  echo 'FINANCE_IDENTITY_UPGRADE=BLOCKED reason=invalid_source_pin'; exit 12;
}
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
[[ -d "$ROOT/.git" ]] || exit 13
[[ "$(git -c safe.directory="$ROOT" -C "$ROOT" rev-parse HEAD)" == "$PIN" ]] || exit 14
[[ -z "$(git -c safe.directory="$ROOT" -C "$ROOT" status --porcelain --untracked-files=all)" ]] || exit 15
[[ -f "$OLD/honartik-finance-owner-host-verifier-v1.cjs" && ! -e "$TARGET" ]] || exit 16
test "$(sha256sum "$OLD/honartik-finance-owner-host-verifier-v1.cjs" | awk '{print $1}')" = ae2ed96c0724c2d10eb3a3b48f559f8135eacf1ba26fd8a95baa94e48394d7a6
for d in "$STATE" "$STATE/pending" "$STATE/inbox" "$STATE/consumed" /etc/prhm-honartik-finance-owner;do
  [[ -d "$d" && ! -L "$d" ]] || exit 17
  [[ "$(stat -Lc '%u:%g:%a' "$d")" == '0:0:700' ]] || exit 18
done
[[ -f "$CONFIG" && ! -L "$CONFIG" ]] || exit 19
[[ "$(stat -Lc '%u:%g:%a' "$CONFIG")" == '0:0:600' ]] || exit 20
# Cannot rotate workflow pin while any unconsumed proof or pending key exists.
[[ -z "$(find "$STATE/pending" "$STATE/inbox" -mindepth 1 -print -quit)" ]] || {
  echo 'FINANCE_IDENTITY_UPGRADE=BLOCKED reason=unconsumed_challenge_present'; exit 21;
}
# Existing consumed receipt ledger must not be edited or truncated.
RECEIPT_BEFORE=$(find "$STATE/consumed" -type f -name '*.consumed' | wc -l)
OLD_SHA=$(/usr/bin/node - "$CONFIG" <<'NODE'
const fs=require('node:fs');
const obj=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(obj.expected_workflow_sha!== '17b8b4cbb54928ac374a9bd8a62a47fd417f9754' ||
   obj.installed_source_sha!== '17b8b4cbb54928ac374a9bd8a62a47fd417f9754' ||
   obj.operation!== 'honartik_back.production.finance_release' ||
   obj.production_base_sha!== '4ac602e874a128c3328f27f3dab473857512cdbf' ||
   obj.source_sha!== 'd1a64e640c9c2cf4788d55566c17728be5813941')
  process.exit(2);
console.log(obj.installed_source_sha);
NODE
)
test "$OLD_SHA" = "$PREV"
FILES='honartik-finance-owner-host-verifier-v1.cjs
honartik-finance-owner-oidc-identity-v1.cjs
honartik-finance-owner-once-fence-v1.cjs
universal-owner-oidc-sealed-transport-v1.cjs
universal-owner-oidc-recovery-gate-v1.cjs
universal-installer-backup-only-native-contract-v1.cjs'
for rel in $FILES;do
  [[ -f "$ROOT/$rel" && ! -L "$ROOT/$rel" ]] || exit 22
  /usr/bin/node --check "$ROOT/$rel" >/dev/null
done
/usr/bin/node --test "$ROOT/test-honartik-finance-owner-host-verifier-v1.cjs" >/dev/null
/usr/bin/node --test "$ROOT/test-honartik-finance-owner-oidc-v1.cjs" >/dev/null
# All preceding checks are source-only. Make an immutable release copy.
install -d -o root -g root -m 0755 "$TARGET"
for rel in $FILES;do
  install -o root -g root -m 0644 "$ROOT/$rel" "$TARGET/$rel"
  cmp -s "$ROOT/$rel" "$TARGET/$rel" || exit 23
done
# Protect original 0600 configuration; atomic replace only, no other state edits.
AUDIT=/root/prhm-dev/audit
[[ -d "$AUDIT" && "$(stat -Lc '%u' "$AUDIT")" == 0 ]] || exit 24
BACKUP=$(mktemp "$AUDIT/honartik-finance-identity-prev-config.XXXXXXXX")
chmod 0600 "$BACKUP"
cp -p "$CONFIG" "$BACKUP"
CONFIG_REPLACED=0
restore_previous() {
  if [[ "$CONFIG_REPLACED" -eq 1 ]];then
    cp -p "$BACKUP" "$CONFIG"
    echo 'FINANCE_IDENTITY_UPGRADE=RESTORED_OLD_PIN'
  fi
}
trap restore_previous ERR
/usr/bin/node - "$CONFIG" "$PIN" <<'NODE'
const fs=require('node:fs'),path=require('node:path');
const dest=process.argv[2],pin=process.argv[3];
const config=JSON.parse(fs.readFileSync(dest,'utf8'));
const permitted=Object.keys(config).sort().join(',');
if(permitted!=='expected_workflow_sha,installed_source_sha,operation,production_base_sha,source_sha')
  process.exit(2);
config.expected_workflow_sha=pin;
config.installed_source_sha=pin;
const tmp=dest+'.next';
const fd=fs.openSync(tmp,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
try{fs.writeFileSync(fd,JSON.stringify(config)+'\n');fs.fsyncSync(fd)}
finally{fs.closeSync(fd)}
fs.renameSync(tmp,dest);
const df=fs.openSync(path.dirname(dest),fs.constants.O_DIRECTORY|fs.constants.O_RDONLY);
try{fs.fsyncSync(df)}finally{fs.closeSync(df)}
NODE
CONFIG_REPLACED=1
[[ "$(stat -Lc '%u:%g:%a' "$CONFIG")" == '0:0:600' ]]
test "$(/usr/bin/node -e 'const o=require(process.argv[1]);if(o.expected_workflow_sha!==process.argv[2])process.exit(1);console.log(o.installed_source_sha)' "$CONFIG" "$PIN")" = "$PIN"
RECEIPT_AFTER=$(find "$STATE/consumed" -type f -name '*.consumed' | wc -l)
test "$RECEIPT_BEFORE" = "$RECEIPT_AFTER"
trap - ERR
echo "FINANCE_PUBLIC_GITHUB_VERIFIER_UPGRADE=PASS source_sha=$PIN"
echo "PREVIOUS_CONFIG_BACKUP=$BACKUP"
echo "CONSUMED_LEDGER_PRESERVED=TRUE count=$RECEIPT_AFTER"
echo 'API_CREDENTIAL_REQUIRED=FALSE'
echo 'IDENTITY_PROOF_VERIFICATION_ONLY=TRUE'
echo 'PRODUCTION_RELEASE_AUTHORIZED=FALSE'
