#!/usr/bin/env bash
# Fixed Node1 host-data snapshot; does NOT claim or copy active QCOW2 VM disks.
# Requires separately authorized SHA-pinned production installation.
set -Eeuo pipefail
umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
if [[ $# -ne 1 || "$1" != --run ]]; then echo 'FIXED_MODE_ONLY' >&2;exit 2;fi
[[ "$(hostname)" = server1.prhm.ir ]] || { echo 'NODE1_HOST_ONLY' >&2;exit 3; }
ROOT=/var/backups/prhm-node1-hostdata-v1
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PARTIAL="$ROOT/.partial-$STAMP-$$"
FINAL="$ROOT/$STAMP"
CHECKER=/usr/local/libexec/prhm-node1-host-archive-check-v1.py
LOCK=/run/lock/prhm-node1-hostdata-v1.lock
SOURCES=(home/imotion/domains home/admin/domains home/parham/domains usr/local/directadmin/data etc)
for b in /usr/bin/mariadb /usr/bin/mariadb-dump /usr/bin/gzip /usr/bin/tar /usr/bin/zstd /usr/bin/sha256sum /usr/bin/flock /usr/bin/python3;do
  [[ -x "$b" ]] || { echo 'REQUIRED_BIN_MISSING' >&2;exit 4; }
done
[[ -s "$CHECKER" ]] || { echo 'CHECKER_NOT_PROVISIONED' >&2;exit 5; }
for p in "${SOURCES[@]}";do
  [[ -d "/$p" ]] || { echo "SOURCE_MISSING:$p" >&2;exit 6; }
done
[[ "$(df -Pk /var/backups | awk 'NR==2{print $4}')" -gt 12582912 ]] || { echo 'DISK_CAPACITY_BELOW_12G' >&2;exit 7; }
install -d -m 0700 "$ROOT"
exec 9>"$LOCK"
flock -n 9 || { echo 'NODE1_BACKUP_LOCK_BUSY' >&2;exit 8; }
[[ ! -e "$FINAL" && ! -e "$PARTIAL" ]] || { echo 'SNAPSHOT_COLLISION' >&2;exit 9; }
cleanup(){
  rc=$?
  if [[ "$rc" != 0 ]];then
    if [[ "$PARTIAL" == "$ROOT"/.partial-20????????T??????Z-* && -d "$PARTIAL" ]];then
      rm -rf -- "$PARTIAL"
    fi
    echo "NODE1_HOSTDATA_STATUS=FAILED exit=$rc" >&2
  fi
}
trap cleanup EXIT
install -d -m 0700 "$PARTIAL" "$PARTIAL/db" "$PARTIAL/files"
DB_LIST="$(/usr/bin/mariadb -N -B -e "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys') ORDER BY SCHEMA_NAME")"
DB_COUNT="$(printf '%s\n' "$DB_LIST" | grep -c .)"
[[ "$DB_COUNT" -ge 6 ]] || { echo 'DB_INVENTORY_INCOMPLETE' >&2;exit 10; }
printf '%s\n' "$DB_LIST" >"$PARTIAL/db/database_names.txt"
mariadb-dump --all-databases --single-transaction --quick --routines --events --triggers --hex-blob --set-charset \
  | gzip -1 >"$PARTIAL/db/all-databases.sql.gz"
gzip -t "$PARTIAL/db/all-databases.sql.gz"
[[ "$(stat -c %s "$PARTIAL/db/all-databases.sql.gz")" -gt 10000 ]] || { echo 'DB_ARCHIVE_TOO_SMALL' >&2;exit 11; }
SITE_BYTES="$(find /home/imotion/domains -type f -printf '%s\n' | awk '{sum+=$1} END{printf "%.0f",sum+0}')"
[[ "$SITE_BYTES" =~ ^[0-9]+$ && "$SITE_BYTES" -gt 1048576 ]] || { echo 'SITE_SOURCE_INCOMPLETE' >&2;exit 12; }
tar -C / -cf - -- "${SOURCES[@]}" | zstd -q -T2 -3 -o "$PARTIAL/files/node1-hostdata.tar.zst"
PROOF="$(python3 "$CHECKER" "$PARTIAL/files/node1-hostdata.tar.zst" "$SITE_BYTES")"
printf '%s\n' "$PROOF" >"$PARTIAL/files/coverage-proof.json"
( cd "$PARTIAL"; sha256sum db/database_names.txt db/all-databases.sql.gz files/node1-hostdata.tar.zst files/coverage-proof.json >SHA256SUMS )
( cd "$PARTIAL"; sha256sum -c SHA256SUMS >/dev/null )
{
  printf 'schema=prhm.node1-hostdata-snapshot.v1\n'
  printf 'host=server1.prhm.ir\n'
  printf 'created_utc=%s\n' "$STAMP"
  printf 'database_count=%s\n' "$DB_COUNT"
  printf 'website_logical_bytes=%s\n' "$SITE_BYTES"
  printf 'vm_disk_backup_proven=false\n'
  printf 'offsite_independence_proven=false\n'
  printf 'sql_replay_proven=false\n'
  printf 'file_restore_proven=false\n'
  printf 'coverage=host_db_and_site_files_only\n'
} >"$PARTIAL/MANIFEST"
( cd "$PARTIAL"; sha256sum MANIFEST >>SHA256SUMS )
touch "$PARTIAL/COMPLETE"
mv -- "$PARTIAL" "$FINAL"
echo "NODE1_HOSTDATA_SNAPSHOT_CREATED=$FINAL"
echo 'NODE1_HOSTDATA_ARCHIVE_SHA=PASS'
echo 'NODE1_VM_BACKUP_PROVEN=NO'
echo 'NODE1_EXTERNAL_OFFSITE_PROVEN=NO'
