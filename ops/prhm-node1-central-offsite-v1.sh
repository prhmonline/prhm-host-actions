#!/usr/bin/env bash
# Fixed central encrypted backup to existing Node1; install only after approved Git-pinned release.
set -Eeuo pipefail
umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
STATE=/var/lib/prhm-central-gdrive-bundle/latest.json
SOURCE_ROOT=/var/backups/prhm-central
RESTIC=/var/lib/prhm-central-gdrive-restic/restic-0.19.1
PASSFILE=/etc/prhm-backup/node1/restic.password
SSHCONFIG=/etc/prhm-backup/node1/ssh_config
KNOWNHOSTS=/etc/prhm-backup/node1/known_hosts
IDENTITY=/etc/prhm-backup/node1/id_ed25519
EVIDENCE_ROOT=/var/lib/prhm-backup/node1-central
REPO=sftp:prhm-node1-backup:/repo/central-production
SFTP_COMMAND='/usr/bin/ssh -F /etc/prhm-backup/node1/ssh_config -s prhm-node1-backup sftp'
WORK=''
STAGE=preflight
SNAP=''
RESTIC_ID=''
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RESULT=FAILED
cleanup(){
 rc=$?
 if [[ -n "$WORK" && "$WORK" == /var/tmp/prhm-central-node1-restore.* ]];then
   rm -rf -- "$WORK" || true
 fi
 mkdir -p -m 0700 "$EVIDENCE_ROOT"
 export rc STAGE SNAP RESTIC_ID STARTED RESULT
 python3 - "$EVIDENCE_ROOT" <<'PY'
import os,json,datetime,pathlib,sys
root=pathlib.Path(sys.argv[1])
now=datetime.datetime.now(datetime.timezone.utc)
success=os.environ['RESULT']=='PASS'
data={'schema':'prhm.node1-central-restic-evidence.v1','started_utc':os.environ['STARTED'],
 'finished_utc':now.isoformat(),'snapshot':os.environ['SNAP'],
 'restic_snapshot_id':os.environ['RESTIC_ID'],'stage':os.environ['STAGE'],
 'status':os.environ['RESULT'],'encrypted_offsite_backup_ok':success,
 'full_restore_ok':success,'exit_code':int(os.environ['rc']),
 'destination':'node1_restricted_sftp','database_mutation':False,
 'source_mutation':False,'remote_delete':False,'retention_prune':False}
f=root/('run-'+now.strftime('%Y%m%dT%H%M%SZ')+'.json')
f.write_text(json.dumps(data,indent=2)+'\n')
f.chmod(0o600)
if success:
 latest=root/'latest.json'
 latest.write_text(json.dumps(data,indent=2)+'\n')
 latest.chmod(0o600)
print('NODE1_RESULT='+data['status']+' STAGE='+data['stage'])
print('NODE1_EVIDENCE='+str(f))
PY
}
trap cleanup EXIT
if [[ $# != 1 || "$1" != --run ]];then
 echo 'FIXED_RUNNER_REQUIRES_APPROVED_SERVICE_INSTALL' >&2;exit 2
fi
[[ -x "$RESTIC" && -s "$STATE" ]] || { STAGE=missing_dependency;exit 3; }
for f in "$PASSFILE" "$SSHCONFIG" "$KNOWNHOSTS" "$IDENTITY";do
 [[ -s "$f" && "$(stat -c '%u:%g:%a' "$f")" == 0:0:600 ]] || { STAGE=missing_secure_ssh_or_password;exit 4; }
done
SNAP="$(python3 - "$STATE" <<'PY'
import json,re,sys
s=json.load(open(sys.argv[1]))
x=s.get('snapshot','')
if s.get('status')!='pass' or not re.fullmatch(r'20[0-9]{6}T[0-9]{6}Z',x):
 raise SystemExit(2)
print(x)
PY
)" || { STAGE=invalid_snapshot_state;exit 5; }
SRC="$SOURCE_ROOT/$SNAP"
[[ -d "$SRC" && -f "$SRC/COMPLETE" && -s "$SRC/SHA256SUMS" ]] || { STAGE=incomplete_source;exit 6; }
[[ "$(df -Pk /var/tmp | awk 'NR==2 {print $4}')" -gt 8388608 ]] || { STAGE=low_restore_disk;exit 7; }
STAGE=verify_source_sha
(cd "$SRC" && sha256sum -c SHA256SUMS >/dev/null) || { STAGE=source_sha_failure;exit 8; }
export RESTIC_REPOSITORY="$REPO"
export RESTIC_PASSWORD_FILE="$PASSFILE"
STAGE=verify_restricted_repo
"$RESTIC" -o "sftp.command=$SFTP_COMMAND" snapshots --json >/dev/null || { STAGE=repo_not_provisioned;exit 9; }
WORK="$(mktemp -d /var/tmp/prhm-central-node1-restore.XXXXXXXX)"
mkdir -m 0700 "$WORK/restore"
STAGE=encrypted_backup
"$RESTIC" -o "sftp.command=$SFTP_COMMAND" backup --json --tag prhm-central-node1-v1 --tag "snapshot-$SNAP" "$SRC" > "$WORK/backup.jsonl" || { STAGE=backup_failed;exit 10; }
RESTIC_ID="$(python3 - "$WORK/backup.jsonl" <<'PY'
import json,sys,re
v=''
for line in open(sys.argv[1]):
 try:o=json.loads(line)
 except ValueError:continue
 if o.get('message_type')=='summary':v=str(o.get('snapshot_id',''))
if not re.fullmatch(r'[0-9a-f]{64}',v):raise SystemExit(2)
print(v)
PY
)" || { STAGE=backup_id_missing;exit 11; }
STAGE=restic_check
"$RESTIC" -o "sftp.command=$SFTP_COMMAND" check --read-data-subset=5% > "$WORK/check.log" 2>&1 || { STAGE=check_failed;exit 12; }
STAGE=isolated_restore
"$RESTIC" -o "sftp.command=$SFTP_COMMAND" restore "$RESTIC_ID" --target "$WORK/restore" > "$WORK/restore.log" 2>&1 || { STAGE=restore_failed;exit 13; }
RESTORED="$WORK/restore/var/backups/prhm-central/$SNAP"
[[ -s "$RESTORED/SHA256SUMS" ]] || { STAGE=manifest_missing;exit 14; }
STAGE=restored_sha256
(cd "$RESTORED" && sha256sum -c SHA256SUMS > "$WORK/file-checks.log") || { STAGE=sha256_fail;exit 15; }
cmp -s "$SRC/MANIFEST" "$RESTORED/MANIFEST" || { STAGE=manifest_mismatch;exit 16; }
STAGE=done
RESULT=PASS
echo "NODE1_ENCRYPTED_REMOTE_RESTORE=PASS snapshot=$SNAP"
