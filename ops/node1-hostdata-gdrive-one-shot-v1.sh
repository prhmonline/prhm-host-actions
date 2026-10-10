#!/usr/bin/env bash
# Encrypted one-shot copy of a verified Node1 hostdata snapshot to existing Google Drive.
# Requires separately approved SHA-pinned deployment, owner-confirmed off-host key escrow.
# --inspect is read-only. --run <UTC snapshot ID> writes ONLY a new encrypted cloud object.
set -Eeuo pipefail
umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

NODE=185.191.76.138
NODE_ROOT=/var/backups/prhm-node1-hostdata-v1
RCLONE=/var/lib/prhm-central-gdrive-restic/rclone-1.75.0
CONFIG=/etc/prhm-rclone/rclone.conf
REMOTE='gdrive-backup:PRHM-Backups/node1-hostdata-offsite-v1'
EXPECTED_ACCOUNT='aytec.ir@gmail.com'
PASSPHRASE=/etc/prhm-backup/physical-offsite/node1-hostdata-gpg.passphrase
ESCROW=/etc/prhm-backup/physical-offsite/node1-hostdata-escrow.json
RELEASE_SHA_FILE=/etc/prhm-backup/physical-offsite/release-commit-sha
STAGING=/var/lib/prhm-node1-hostdata-physical-offsite-v1
LOGROOT=/var/log/prhm-backup-assurance/node1-hostdata-physical-offsite-v1
GPG=/usr/bin/gpg
RESERVE_BYTES=8589934592
REMOTE_RESERVE_BYTES=1073741824
SOURCE_HOST=prhm-production.prhm.ir
GIT_REPO='prhmonline/prhm-host-actions'
GIT_BRANCH='ops/node1-hostdata-physical-offsite-candidate-v1'
# Installer must pin this script's commit SHA in a separate release record.
RUN_MODE="${1:-}"
SNAP="${2:-}"

fail(){ echo "OFFSITE_BLOCKED:$1" >&2; exit 3; }
assert_host(){
  [[ "$(hostname)" == "$SOURCE_HOST" ]] || fail WRONG_SOURCE_HOST
}
assert_runtime(){
  [[ -x "$RCLONE" && -f "$CONFIG" && -x "$GPG" ]] || fail REQUIRED_RUNTIME_MISSING
  [[ -x /usr/bin/ssh && -x /usr/bin/tar && -x /usr/bin/sha256sum ]] || fail REQUIRED_BIN_MISSING
  [[ "$(stat -c '%u:%a' "$CONFIG")" == '0:600' ]] || fail UNSAFE_CLOUD_CONFIG
}
rclone_read(){
  "$RCLONE" --config "$CONFIG" --retries 2 --low-level-retries 3 "$@"
}
ssh_node(){
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=12 root@"$NODE" "$@"
}
quota_json(){
  rclone_read about gdrive-backup: --json
}
verify_destination_identity(){
  # rclone's own configured OAuth token is checked against Google's authenticated
  # About.user.emailAddress. Provider quota/folder names are NOT identity proof.
  # The token is read locally, never logged or placed on the command line.
  # A read-only "about" first allows rclone to refresh an expired access token.
  quota_json >/dev/null || fail DESTINATION_IDENTITY_REFRESH_UNAVAILABLE
  python3 - "$CONFIG" "$EXPECTED_ACCOUNT" <<'PY'
import configparser
import json
import sys
import urllib.error
import urllib.request

config_path, expected = sys.argv[1:]
cfg = configparser.ConfigParser(interpolation=None)
if not cfg.read(config_path) or not cfg.has_section('gdrive-backup'):
    raise SystemExit('DESTINATION_IDENTITY_CONFIG_MISSING')
try:
    token = json.loads(cfg.get('gdrive-backup', 'token'))
    access = token.get('access_token', '')
except (ValueError, configparser.Error, TypeError):
    raise SystemExit('DESTINATION_IDENTITY_TOKEN_INVALID')
if not access:
    raise SystemExit('DESTINATION_IDENTITY_TOKEN_MISSING')
request = urllib.request.Request(
    'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
    headers={'Authorization': 'Bearer ' + access,
             'Accept': 'application/json'},
)
try:
    with urllib.request.urlopen(request, timeout=15) as response:
        profile = json.load(response)
except (urllib.error.URLError, ValueError, OSError):
    raise SystemExit('DESTINATION_IDENTITY_API_UNAVAILABLE')
actual = profile.get('user', {}).get('emailAddress', '').lower()
if actual != expected.lower():
    raise SystemExit('DESTINATION_ACCOUNT_MISMATCH')
print('DESTINATION_ACCOUNT_BOUND=PASS')
PY
}
validate_snapshot_name(){
  [[ "$SNAP" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] || fail INVALID_SNAPSHOT_ID
}
remote_capacity(){
  local free
  free="$(quota_json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(int(d.get("free",-1)))')" || fail REMOTE_QUOTA_UNAVAILABLE
  [[ "$free" =~ ^[0-9]+$ ]] || fail REMOTE_QUOTA_UNKNOWN
  printf '%s' "$free"
}
require_key_escrow(){
  for p in "$PASSPHRASE" "$ESCROW" "$RELEASE_SHA_FILE";do
    [[ -f "$p" && ! -L "$p" ]] || fail MISSING_OFFHOST_ESCROW
    [[ "$(stat -c '%u:%a' "$p")" == '0:600' ]] || fail ESCROW_PERMISSIONS
  done
  python3 - "$PASSPHRASE" "$ESCROW" <<'PY'
import hashlib,json,sys
secret=open(sys.argv[1],'rb').read().rstrip(b'\n')
if len(secret)<48 or len(secret)>256 or b'\n' in secret or b'\r' in secret: raise SystemExit('INVALID_KEY_STRENGTH')
data=json.load(open(sys.argv[2]))
if data.get('schema')!='prhm.offsite-key-escrow.v1' or data.get('independent_physical_copy_confirmed') is not True or data.get('key_sha256')!=hashlib.sha256(secret).hexdigest(): raise SystemExit('OFFHOST_RECOVERY_KEY_NOT_ATTESTED')
if data.get('confirmed_by')!='owner': raise SystemExit('KEY_ESCROW_OWNER_NOT_CONFIRMED')
PY
}
inspect(){
  assert_host
  assert_runtime
  verify_destination_identity || fail DESTINATION_ACCOUNT_NOT_VERIFIED
  local free
  free="$(remote_capacity)" || fail REMOTE_CAPACITY_UNKNOWN
  echo "RCLONE_PROVIDER_ACCESS=PASS"
  echo "RCLONE_REMOTE_FREE_BYTES=$free"
  echo "NO_DATA_UPLOAD=TRUE"
  echo "CLIENT_ID_RETIREMENT_WARNING=CHECK_PROVIDER_SHARED_CLIENT"
}
guard_capacity(){
  local desired="$1" free local_free
  free="$(remote_capacity)"
  (( free > desired + REMOTE_RESERVE_BYTES )) || fail REMOTE_QUOTA_INSUFFICIENT
  local_free="$(df -PB1 "$STAGING" | awk 'NR==2{print $4}')"
  [[ "$local_free" =~ ^[0-9]+$ ]] || fail LOCAL_CAPACITY_UNKNOWN
  (( local_free > desired*3 + RESERVE_BYTES )) || fail LOCAL_CAPACITY_INSUFFICIENT
}
run_backup(){
  validate_snapshot_name
  assert_host
  assert_runtime
  verify_destination_identity || fail DESTINATION_ACCOUNT_NOT_VERIFIED
  require_key_escrow
  # Never race the local Node1 backup service or use a partial/unknown snapshot.
  local n expected_size local_encrypted local_received remote_object stage logpath size_file release_sha
  release_sha="$(cat "$RELEASE_SHA_FILE")"
  [[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail RELEASE_GIT_SHA_NOT_PINNED
  n="$SNAP"
  [[ -d "$STAGING" ]] || fail STAGING_NOT_PROVISIONED
  [[ "$(stat -c '%u:%a' "$STAGING")" == '0:700' ]] || fail STAGING_PERMISSIONS
  ssh_node "test -f '$NODE_ROOT/$n/COMPLETE' && cd '$NODE_ROOT/$n' && sha256sum -c SHA256SUMS >/dev/null" || fail NODE1_SNAPSHOT_INTEGRITY
  expected_size="$(ssh_node "stat -c %s '$NODE_ROOT/$n/files/node1-hostdata.tar.zst'; stat -c %s '$NODE_ROOT/$n/db/all-databases.sql.gz'" | awk '{s+=$1} END{printf "%.0f",s}')" || fail NODE1_SOURCE_SIZE_UNAVAILABLE
  [[ "$expected_size" =~ ^[0-9]+$ ]] || fail BAD_SOURCE_SIZE
  (( expected_size > 104857600 && expected_size < 10000000000 )) || fail UNEXPECTED_SOURCE_SIZE
  guard_capacity "$expected_size"
  remote_object="$REMOTE/$n.snapshot.tar.gpg"
  # Fail closed on a missing/inaccessible destination folder or API failure.
  # The target folder must be provisioned separately by a SHA-pinned release.
  local listing
  listing="$(rclone_read lsjson "$REMOTE" --files-only)" || fail REMOTE_FOLDER_OR_INVENTORY_UNAVAILABLE
  if printf '%s' "$listing" | python3 -c 'import json,sys; items=json.load(sys.stdin); sys.exit(0 if any(x.get("Name")==sys.argv[1] for x in items) else 1)' "$n.snapshot.tar.gpg"; then
    fail REMOTE_OBJECT_ALREADY_EXISTS
  fi
  mkdir -p "$LOGROOT"
  [[ "$(stat -c '%u:%a' "$LOGROOT")" == '0:700' ]] || fail LOGROOT_PERMISSIONS
  stage="$(mktemp -d "$STAGING/.staging-$n-XXXXXXXX")"
  cleanup(){ rc=$?; if [[ -n "$stage" && "$stage" == "$STAGING"/.staging-* && -d "$stage" ]]; then rm -rf -- "$stage";fi; if [[ "$rc" != 0 ]];then echo "OFFSITE_RESULT=FAILED exit=$rc" >&2;fi; }
  trap cleanup EXIT
  local_encrypted="$stage/$n.snapshot.tar.gpg"
  local_received="$stage/$n.downloaded.gpg"
  echo "STAGE=ENCRYPT_NODE1_STREAM"
  # Binary data never appears in logs, never reaches public cloud unencrypted.
  ssh_node "tar -C '$NODE_ROOT' -cf - '$n'" | "$GPG" --batch --yes --pinentry-mode loopback --passphrase-file "$PASSPHRASE" --symmetric --cipher-algo AES256 --compress-algo none --s2k-digest-algo SHA256 --output "$local_encrypted"
  [[ -s "$local_encrypted" ]] || fail ENCRYPTION_EMPTY
  echo "STAGE=IMMUTABLE_CLOUD_UPLOAD"
  rclone_read --transfers 1 --checkers 1 --drive-chunk-size 8M --immutable copyto "$local_encrypted" "$remote_object"
  echo "STAGE=INDEPENDENT_CLOUD_DOWNLOAD"
  rclone_read --transfers 1 --checkers 1 copyto "$remote_object" "$local_received"
  cmp -s "$local_encrypted" "$local_received" || fail REMOTE_BYTES_DIFFER
  mkdir -m 0700 "$stage/restored"
  echo "STAGE=DECRYPT_RESTORE_ISOLATED"
  "$GPG" --batch --yes --pinentry-mode loopback --passphrase-file "$PASSPHRASE" --decrypt "$local_received" 2>/dev/null | tar -C "$stage/restored" --no-same-owner --no-same-permissions -xf -
  [[ -f "$stage/restored/$n/COMPLETE" ]] || fail RESTORED_INCOMPLETE
  ( cd "$stage/restored/$n"; sha256sum -c SHA256SUMS >/dev/null ) || fail RESTORED_SNAPSHOT_SHA256_BAD
  [[ -s "$stage/restored/$n/files/coverage-proof.json" ]] || fail RESTORED_COVERAGE_MISSING
  python3 - "$stage/restored/$n" "$remote_object" "$GIT_REPO" "$GIT_BRANCH" "$release_sha" <<'PY' >"$stage/evidence.json"
import json,sys,datetime,os
p,remote,repo,branch,commit_sha=sys.argv[1:]
proof=json.load(open(os.path.join(p,'files/coverage-proof.json')))
names=open(os.path.join(p,'db/database_names.txt')).read().splitlines()
if proof.get('ok') is not True or proof.get('ratio',0)<.95 or proof.get('site_regular_files',0)<1000 or len(names)<6: raise SystemExit('RESTORED_COVERAGE_INVALID')
print(json.dumps({'schema':'prhm.node1-hostdata-cloud-proof.v1',
  'repo':repo,'branch':branch,'commit_sha':commit_sha,'destination':'Google Drive encrypted one-shot','rollback':False,'status':'PASS','verified_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'remote_object':remote,'snapshot':os.path.basename(p),'encrypted':True,
  'cloud_download_byte_compare':True,'full_snapshot_sha256_restored':True,
  'site_regular_files':proof['site_regular_files'],'site_coverage_ratio':proof['ratio'],
  'database_count':len(names),'vm_disk_backup_proven':False,'key_escrow_physical_recovery_proven':False},sort_keys=True))
PY
  logpath="$LOGROOT/$n-cloud-verified.json"
  [[ ! -e "$logpath" ]] || fail EVIDENCE_COLLISION
  install -m 0600 "$stage/evidence.json" "$logpath"
  echo "OFFSITE_RESULT=PASS"
  echo "OFFSITE_PROOF=$logpath"
  echo "FULL_VM_BACKUP_PROVEN=NO"
}
case "$RUN_MODE" in
  --inspect) [[ $# == 1 ]] || fail INVALID_ARGUMENTS; inspect ;;
  --run) [[ $# == 2 ]] || fail INVALID_ARGUMENTS; run_backup ;;
  *) fail FIXED_MODES_ONLY ;;
esac
