#!/usr/bin/env bash
# One-time Root OPERATOR install of source-reviewed identity-only verifier.
# No registered root action, generic sudo, app deployment or financial changes.
set -Eeuo pipefail
umask 077
[[ $EUID == 0 ]] || { echo 'FINANCE_HOST_INSTALL=BLOCKED reason=root_operator_required'; exit 10; }
[[ "$(hostname -f)" == prhm-production.prhm.ir ]] || {
  echo 'FINANCE_HOST_INSTALL=BLOCKED reason=wrong_host'; exit 11;
}
PIN="$INSTALL_SOURCE_SHA"
[[ "$PIN" =~ ^[a-f0-9]{40}$ ]] || {
  echo 'FINANCE_HOST_INSTALL=BLOCKED reason=immutable_sha_required';exit 12;
}
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
[[ -d "$ROOT/.git" ]] || {
  echo 'FINANCE_HOST_INSTALL=BLOCKED reason=reviewed_git_tree_required'; exit 13;
}
[[ "$(git -c safe.directory="$ROOT" -C "$ROOT" rev-parse HEAD)" == "$PIN" ]] || {
  echo 'FINANCE_HOST_INSTALL=BLOCKED reason=unreviewed_source_sha';exit 14;
}
[[ -z "$(git -c safe.directory="$ROOT" -C "$ROOT" status --porcelain --untracked-files=all)" ]] || {
  echo 'FINANCE_HOST_INSTALL=BLOCKED reason=source_tree_dirty';exit 15;
}
FILES='honartik-finance-owner-host-verifier-v1.cjs
honartik-finance-owner-oidc-identity-v1.cjs
honartik-finance-owner-once-fence-v1.cjs
universal-owner-oidc-sealed-transport-v1.cjs
universal-owner-oidc-recovery-gate-v1.cjs
universal-installer-backup-only-native-contract-v1.cjs'
for rel in $FILES;do
  [[ -f "$ROOT/$rel" && ! -L "$ROOT/$rel" ]] || {
    echo 'FINANCE_HOST_INSTALL=BLOCKED reason=missing_or_symlinked_source';exit 16;
  }
  /usr/bin/node --check "$ROOT/$rel" >/dev/null
done
/usr/bin/node --test "$ROOT/test-honartik-finance-owner-host-verifier-v1.cjs" >/dev/null
/usr/bin/node --test "$ROOT/test-honartik-finance-owner-oidc-v1.cjs" >/dev/null

TARGET_BASE=/opt/prhm-honartik-finance-owner
RELEASES="$TARGET_BASE/releases"
TARGET="$RELEASES/$PIN"
STATE=/var/lib/prhm-honartik-finance-owner
CONFIG_DIR=/etc/prhm-honartik-finance-owner
CONFIG="$CONFIG_DIR/identity.json"
for dir in "$TARGET_BASE" "$RELEASES" "$STATE" "$CONFIG_DIR";do
  [[ ! -L "$dir" ]] || {
    echo 'FINANCE_HOST_INSTALL=BLOCKED reason=symlinked_runtime_parent';exit 17;
  }
done
[[ ! -e "$TARGET" && ! -e "$CONFIG" ]] || {
  echo 'FINANCE_HOST_INSTALL=BLOCKED reason=existing_install_review_required';exit 18;
}
[[ ! -e "$STATE/consumed" && ! -e "$STATE/pending" && ! -e "$STATE/inbox" ]] || {
  echo 'FINANCE_HOST_INSTALL=BLOCKED reason=existing_receipts_cannot_be_reset';exit 19;
}
# Non-executing source files become root-owned only after read-only preflight.
install -d -o root -g root -m 0755 "$TARGET_BASE" "$RELEASES" "$TARGET"
install -d -o root -g root -m 0700 "$STATE" "$STATE/pending" "$STATE/inbox" "$STATE/consumed" "$CONFIG_DIR"
for rel in $FILES;do
  install -o root -g root -m 0644 "$ROOT/$rel" "$TARGET/$rel"
  cmp -s "$ROOT/$rel" "$TARGET/$rel" || {
    echo 'FINANCE_HOST_INSTALL=BLOCKED reason=source_copy_mismatch';exit 20;
  }
done
/usr/bin/node - "$PIN" "$CONFIG" <<'NODE'
'use strict';
const fs=require('node:fs');
const pin=process.argv[2],dest=process.argv[3];
const config={
 expected_workflow_sha:pin, installed_source_sha:pin,
 operation:'honartik_back.production.finance_release',
 production_base_sha:'4ac602e874a128c3328f27f3dab473857512cdbf',
 source_sha:'d1a64e640c9c2cf4788d55566c17728be5813941'
};
fs.writeFileSync(dest,JSON.stringify(config)+'\n',{mode:0o600,flag:'wx'});
NODE
[[ "$(stat -Lc '%u:%g:%a' "$CONFIG")" == '0:0:600' ]] || exit 21
for p in "$STATE" "$STATE/pending" "$STATE/inbox" "$STATE/consumed" "$CONFIG_DIR";do
  [[ "$(stat -Lc '%u:%g:%a' "$p")" == '0:0:700' ]] || exit 22
done
[[ "$(stat -Lc '%u:%g:%a' "$TARGET/honartik-finance-owner-host-verifier-v1.cjs")" == '0:0:644' ]] || exit 23
sha256sum "$TARGET/honartik-finance-owner-host-verifier-v1.cjs"
echo "FINANCE_HOST_VERIFIER_INSTALL=PASS source_sha=$PIN"
echo 'FINANCE_HOST_IDENTITY_ONLY=TRUE'
echo 'FINANCE_HOST_CAN_EXECUTE_RELEASE=FALSE'
echo "FINANCE_API_READ_TOKEN_PRESENT=$(test -s "$CONFIG_DIR/github-api-read.token" && echo TRUE || echo FALSE)"
echo 'PRODUCTION_CHANGED=FALSE'
