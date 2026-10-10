#!/usr/bin/env bash
set -Eeuo pipefail
S="$(dirname "$0")/central-offsite-restore-drill-20261010-v1.sh"
bash -n "$S"
if bash "$S" --unsafe-option >/dev/null 2>&1; then
  echo 'FAIL: unsafe invocation accepted' >&2; exit 1
fi
python3 - "$S" <<'PY'
import pathlib,sys
s=pathlib.Path(sys.argv[1]).read_text()
checks={
 'fixed_source':'gdrive-backup:PRHM-Backups/bundles/central/20261010T092103Z.restic-repo.tar',
 'fixed_sha':'8977231a8447e2634720835d255a4ff1486b2f085ea32172ec8b54adf4a37f63',
 'short_lived_workspace':'mktemp -d /var/tmp/prhm-gdrive-restore-check-20261010.',
 'one_rclone_transfer':'--retries 1 --low-level-retries 1',
 'full_hash':'REMOTE_BUNDLE_FULL_SHA256=PASS',
 'isolation':'--target "$WORK/restore"',
 'restored_checksums':'sha256sum -c SHA256SUMS',
 'cleanup':'rm -rf -- "$WORK"',
 'auth_guard':'unsafe_secret_mode',
 'rate_fail_classification':'remote_rate_limited'
}
for name,needle in checks.items():
 assert needle in s,name
assert s.count('copyto')==1
assert not any(t in s for t in ['rclone delete','rclone purge','DELETE FROM','DROP TABLE','--apply','systemctl restart','systemctl stop'])
print('READ_ONLY_FIXED_DRILL_CONTRACT=PASS checks='+str(len(checks)))
PY
