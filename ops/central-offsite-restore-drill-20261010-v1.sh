#!/usr/bin/env bash
# Fixed-snapshot Google Drive full restore drill. No writes to remote, databases, sites, services.
set -Eeuo pipefail
umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
SNAP=20261010T092103Z
REMOTE=gdrive-backup:PRHM-Backups/bundles/central/20261010T092103Z.restic-repo.tar
SHA=8977231a8447e2634720835d255a4ff1486b2f085ea32172ec8b54adf4a37f63
SIZE=1328373760
RCLONE=/var/lib/prhm-central-gdrive-restic/rclone-1.75.0
RESTIC=/var/lib/prhm-central-gdrive-restic/restic-0.19.1
CONFIG=/etc/prhm-rclone/rclone.conf
PASSFILE=/etc/prhm-production-central-gdrive-restic.password
STATE=/var/lib/prhm-central-gdrive-bundle/latest.json
WORK=''
STAGE=preflight
CATEGORY=unstarted
STATUS=INDETERMINATE
STARTED="$(date -u +%FT%TZ)"
COUNT=0
record(){
 rc=$?
 if [[ -n "$WORK" && "$WORK" == /var/tmp/prhm-gdrive-restore-check-20261010.* ]]; then
   rm -rf -- "$WORK" || true
 fi
 mkdir -p -m 0700 /var/log/prhm-backup-assurance
 export rc STAGE CATEGORY STATUS STARTED COUNT
 python3 - <<'PY'
import json,os,pathlib,datetime
now=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
p=pathlib.Path('/var/log/prhm-backup-assurance/gdrive-20261010T092103Z-'+now+'.json')
d={'schema':'prhm.central-gdrive-remote-full-restore.v1','snapshot':'20261010T092103Z',
   'started_utc':os.environ['STARTED'],'finished_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
   'status':os.environ['STATUS'],'last_stage':os.environ['STAGE'],
   'outcome_category':os.environ['CATEGORY'],'verified_file_count':int(os.environ['COUNT']),
   'exit_code':int(os.environ['rc']),'remote_write':False,
   'production_data_mutation':False,'work_scope':'ephemeral_isolated'}
p.write_text(json.dumps(d,indent=2)+'\n');p.chmod(0o600)
print('EVIDENCE_FILE='+str(p));print('RESULT='+d['status']+' CATEGORY='+d['outcome_category'])
PY
}
trap record EXIT
if [[ $# != 1 || "$1" != '--read-only-drill' ]];then CATEGORY=invalid_mode;exit 2;fi
[[ -x "$RCLONE" && -x "$RESTIC" && -s "$CONFIG" && -s "$PASSFILE" ]] || { CATEGORY=missing_dependency;exit 3; }
[[ "$(stat -c %a "$CONFIG")" == 600 && "$(stat -c %a "$PASSFILE")" == 600 ]] || { CATEGORY=unsafe_secret_mode;exit 4; }
[[ "$(systemctl is-active prhm-production-central-offsite-backup.service)" != active ]] || { CATEGORY=backup_service_busy;exit 5; }
python3 - "$STATE" "$REMOTE" "$SHA" "$SIZE" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]))
assert (s.get('status'),s.get('snapshot'),s.get('remote'),s.get('bundle_sha256'),s.get('bundle_size'))==('pass','20261010T092103Z',sys.argv[2],sys.argv[3],int(sys.argv[4]))
PY
[[ "$(df -Pk /var/tmp | awk 'NR==2 {print $4}')" -gt 8388608 ]] || { CATEGORY=low_disk_space;exit 6; }
WORK="$(mktemp -d /var/tmp/prhm-gdrive-restore-check-20261010.XXXXXXXX)"
mkdir -m 0700 "$WORK/extract" "$WORK/restore"
STAGE=remote_download
echo 'REMOTE_READ_STARTED snapshot=20261010T092103Z'
set +e
timeout --signal=TERM --kill-after=10s 240s "$RCLONE" copyto "$REMOTE" "$WORK/bundle.tar" --config "$CONFIG" \
 --retries 1 --low-level-retries 1 --contimeout 8s --timeout 45s --transfers 1 --checkers 1 \
 --tpslimit 0.5 --tpslimit-burst 1 --stats 0 > "$WORK/rclone.out" 2> "$WORK/rclone.err"
rclone_rc=$?
set -e
if [[ $rclone_rc -ne 0 ]];then
 CATEGORY=remote_read_failure
 if grep -Eiq '429|quotaExceeded|rate.limit|too many requests' "$WORK/rclone.err";then CATEGORY=remote_rate_limited
 elif grep -Eiq '401|403|invalid_grant|unauthorized' "$WORK/rclone.err";then CATEGORY=remote_auth_error
 elif [[ $rclone_rc -eq 124 ]];then CATEGORY=remote_download_timeout
 elif grep -Eiq 'timeout|deadline|connection|root directory id' "$WORK/rclone.err";then CATEGORY=remote_transport_error;fi
 echo "REMOTE_READ_FAILED category=$CATEGORY (no retry)" >&2
 exit 31
fi
STAGE=full_bundle_sha256
[[ "$(stat -c %s "$WORK/bundle.tar")" == "$SIZE" ]] || { CATEGORY=remote_wrong_size;exit 32; }
[[ "$(sha256sum "$WORK/bundle.tar" | awk '{print $1}')" == "$SHA" ]] || { CATEGORY=remote_sha256_mismatch;exit 33; }
echo 'REMOTE_BUNDLE_FULL_SHA256=PASS'
STAGE=safe_archive_extract
python3 - "$WORK/bundle.tar" <<'PY'
import tarfile,sys,pathlib
with tarfile.open(sys.argv[1],'r:') as tar:
 m=tar.getmembers()
 if not 1<=len(m)<=50000:raise ValueError('invalid_tar_length')
 for x in m:
  parts=pathlib.PurePosixPath(x.name).parts
  if not parts or parts[0]!='repo' or '..' in parts or x.name.startswith('/') or not (x.isfile() or x.isdir()):
   raise ValueError('unsafe_tar_path_or_type')
print('ARCHIVE_SAFE_PATHS=PASS')
PY
tar -xf "$WORK/bundle.tar" -C "$WORK/extract" --no-same-owner --no-same-permissions
export RESTIC_REPOSITORY="$WORK/extract/repo"
export RESTIC_PASSWORD_FILE="$PASSFILE"
STAGE=restic_repository_check
"$RESTIC" snapshots --json > "$WORK/snapshots.json"
python3 - "$WORK/snapshots.json" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]))
assert isinstance(s,list) and len(s)>0
print('RESTIC_SNAPSHOT_COUNT='+str(len(s)))
PY
"$RESTIC" check --read-data-subset=10% > "$WORK/restic-check.log" 2>&1 || { CATEGORY=restic_check_failure;exit 34; }
echo 'RESTIC_CHECK_10_PERCENT=PASS'
STAGE=isolated_full_restore
"$RESTIC" restore latest --target "$WORK/restore" > "$WORK/restore.log" 2>&1 || { CATEGORY=restore_failed;exit 35; }
RESTORED="$WORK/restore/data/snapshot"
[[ -s "$RESTORED/SHA256SUMS" ]] || { CATEGORY=missing_restored_manifest;exit 36; }
STAGE=restored_file_sha256
(cd "$RESTORED" && sha256sum -c SHA256SUMS > "$WORK/checks.log") || { CATEGORY=restored_sha256_failure;exit 37; }
COUNT="$(grep -c ': OK$' "$WORK/checks.log" || true)"
[[ "$COUNT" -ge 20 ]] || { CATEGORY=too_few_verified_files;exit 38; }
STATUS=PASS
CATEGORY=remote_full_restore_verified
STAGE=completed
echo "REMOTE_FULL_RESTORE=PASS verified_file_count=$COUNT"
