"""Real fixed-scope U06 Native Universal/financial/Node1 Root worker.

IMPORT-ONLY, never a CLI. A separately verified and consumed official
U06 Level-4 receipt and a durable root-only journal/fence MUST exist before
the Root Host Action calls these stages. This is not an approval issuer,
Host Action registrar, credential constructor or backend deployer.

Only honartik_db, immutable installed Universal, fixed six finance totals,
pinned private Root state, isolated networkless MariaDB and Node1 restricted
Restic repository are allowed. No caller-selected SQL/host/user/path.
"""
from __future__ import annotations
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import uuid

HOST = "prhm-production.prhm.ir"
PROFILE = Path("/etc/deploy-control/projects/honartik_back.production.json")
PROFILE_SHA = "79783874cb5170eec3dedcc536f713c4567c585e118f881c1035862a7bba8698"
ADAPTER_DIR = Path("/usr/local/libexec/deploy-control/universal/current")
ADAPTER = ADAPTER_DIR / "universal/adapters/database.py"
ADAPTER_SHA = "d81223e31bde684f83d1b8b3c93a8fdf2bd4797db33159bf681e6d3898ade2a3"
CREDENTIAL = Path("/etc/deploy-control/secrets/honartik_back/mysql.cnf")
ROOT = Path("/var/lib/prhm-agent-selfmaint-exec/honartik-u06-native-root")
BACKUPS = Path("/var/backups/prhm-u06-native")
POLICY = Path("/opt/prhm-company-control-plane/config/approval-policy.json")
POLICY_SHA = "aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934"
RESTIC = Path("/var/lib/prhm-central-gdrive-restic/restic-0.19.1")
RESTIC_SHA = "20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639"
RESTIC_PASSFILE = Path("/etc/prhm-backup/node1/restic.password")
SSH_CONFIG = Path("/etc/prhm-backup/node1/ssh_config")
SSH_HOSTS = Path("/etc/prhm-backup/node1/known_hosts")
SSH_ID = Path("/etc/prhm-backup/node1/id_ed25519")
REPO = "sftp:prhm-node1-backup:/repo/central-production"
SFTP_COMMAND = "/usr/bin/ssh -F /etc/prhm-backup/node1/ssh_config -s prhm-node1-backup sftp"
ACTION = "honartik_u06_native_backup_register_v1"
OPERATION = "host_action." + ACTION
PROFILE_BACKUP_KEY = "offsite_required"
RUN_ID = re.compile(r"^[0-9a-f]{40}$")
APPROVAL_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",re.I)
FINANCE = {
 "finance_transactions": "amount",
 "finance_wallet": "amount",
 "reserve": "id",
 "reserve_item": "price",
 "iticket_reservation": "total_amount",
 "finance_offline_pay": "id",
}

def fail(s):
    raise RuntimeError("U06_NATIVE_"+s)

def demand(x,s):
    if not x: fail(s)

def digest(path):
    h=hashlib.sha256()
    with open(path,"rb") as f:
        while True:
            buf=f.read(1024*1024)
            if not buf:break
            h.update(buf)
    return h.hexdigest()

def trusted(file, sha=None, mode=None, max_bytes=None):
    s=file.lstat()
    demand(stat.S_ISREG(s.st_mode) and not file.is_symlink() and s.st_uid==0
           and s.st_gid==0 and s.st_nlink==1 and not(s.st_mode&0o022),
           "UNTRUSTED_FILE")
    if mode is not None:demand(stat.S_IMODE(s.st_mode)==mode,"FILE_MODE")
    if max_bytes is not None:demand(s.st_size<=max_bytes,"OVERSIZED_FILE")
    if sha is not None:demand(digest(file)==sha,"SOURCE_SHA_DRIFT")
    return s

def trusted_directory(path):
    s=path.lstat()
    demand(stat.S_ISDIR(s.st_mode) and not path.is_symlink()
           and s.st_uid==0 and s.st_gid==0
           and stat.S_IMODE(s.st_mode)==0o700,"PRIVATE_DIRECTORY_REQUIRED")
    return path

def syncdir(path):
    d=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(d)
    finally:os.close(d)

def write_json(dir,name,record):
    trusted_directory(dir)
    target=dir/name
    tmp=dir/("."+name+"."+uuid.uuid4().hex+".tmp")
    raw=(json.dumps(record,sort_keys=True,separators=(",",":"))+"\n").encode()
    fd=os.open(tmp,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,"wb",closefd=False) as f:
            f.write(raw);f.flush();os.fsync(fd)
    finally:os.close(fd)
    os.replace(tmp,target);syncdir(dir)

def json_trusted(path):
    trusted(path,mode=0o600,max_bytes=400000)
    return json.loads(path.read_text())

def require_active(run_id,approval_id):
    demand(os.geteuid()==0 and socket.getfqdn()==HOST,"ROOT_HOST")
    demand(bool(RUN_ID.fullmatch(run_id)) and
           bool(APPROVAL_ID.fullmatch(approval_id)),"RUN_OR_APPROVAL_ID")
    trusted(PROFILE,PROFILE_SHA,max_bytes=200000)
    trusted(ADAPTER,ADAPTER_SHA,max_bytes=300000)
    trusted(POLICY,POLICY_SHA,max_bytes=200000)
    trusted_directory(ROOT)
    j=json_trusted(ROOT/"u06-rollback.json")
    demand(j.get("schema")=="prhm.u06.root-rollback.v1" and
           j.get("id")==run_id and j.get("state")=="PREPARED",
           "ROOT_JOURNAL_NOT_PREPARED")
    locked=json_trusted(ROOT/"u06-exclusive.lease")
    demand(locked.get("id")==run_id,"ROOT_LEASE_ID_MISMATCH")
    consumed=json_trusted(ROOT/"l4-consumed"/(approval_id+".json"))
    demand(consumed.get("schema")=="prhm.u06.native-root-l4-consumed-fence.v1"
       and consumed.get("journal_id")==run_id
       and consumed.get("action")==ACTION
       and consumed.get("operation")==OPERATION
       and consumed.get("state")=="CONSUMED_NO_REPLAY"
       and consumed.get("receipt_signed_and_consumed") is True
       and consumed.get("policy_sha256")==POLICY_SHA,
       "DURABLE_LEVEL4_FENCE_MISSING")
    return j

def run(args,stdin=None,timeout=300,max_output=60000,env=None):
    proc=subprocess.run(args,input=stdin,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                        timeout=timeout,env=env)
    # Stderr can contain the SQL client credential context: fail with no echo.
    demand(proc.returncode==0 and not proc.stdout is None and
           len(proc.stdout)<=max_output,"FIXED_SUBPROCESS_FAILED")
    return proc.stdout

def sql_query(q):
    demand(len(q)<1600 and ";" not in q,"READONLY_QUERY_NOT_FIXED")
    return run(["/usr/bin/mysql","--defaults-extra-file="+str(CREDENTIAL),
        "--batch","--skip-column-names","--execute="+q],
        timeout=45,max_output=2000).decode().strip()

def fixed_stats(query):
    return sql_query(query)

def live_finance():
    trusted(CREDENTIAL,mode=0o600,max_bytes=4096)
    return {table:fixed_stats("SELECT COUNT(*),COALESCE(SUM("+column+"),0) FROM honartik_db."+table)
            for table,column in FINANCE.items()}

def schema_metrics(query):
    return int(fixed_stats(query))

def live_schema():
    a=schema_metrics("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=0x686f6e617274696b5f6462 AND table_type=0x42415345205441424c45")
    b=schema_metrics("SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=0x686f6e617274696b5f6462")
    return a,b

def ensure_archive_directory(run_id):
    trusted_directory(BACKUPS)
    d=BACKUPS/run_id
    if d.exists():trusted_directory(d)
    else:
        d.mkdir(mode=0o700);syncdir(BACKUPS)
        trusted_directory(d)
    return d

def cfg():
    data=json.loads(PROFILE.read_text())
    demand(data.get("project")=="honartik_back" and
           data.get("environment")=="production","PROFILE_SCOPE_DRIFT")
    db=data.get("databases")
    demand(isinstance(db,list) and len(db)==1,"DB_PROFILE_SHAPE")
    c=db[0]
    for k,v in {"id":"main","adapter":"mysql","name":"honartik_db",
                "host":"127.0.0.1","port":3306,
                "connection_file":str(CREDENTIAL)}.items():
        demand(c.get(k)==v,"DB_PROFILE_PIN_"+k)
    return c

def installed():
    if str(ADAPTER_DIR) not in sys.path:sys.path.insert(0,str(ADAPTER_DIR))
    from universal.adapters.database import backup_database,verify_database_restore
    return backup_database,verify_database_restore

def native_backup(run_id,approval_id):
    require_active(run_id,approval_id)
    demand(live_schema()==(69,49),"LIVE_SCHEMA_CHANGED")
    before=live_finance()
    d=ensure_archive_directory(run_id)
    backup_database,_=installed()
    stage=d/"native"
    demand(not stage.exists(),"NATIVE_BACKUP_ALREADY_EXISTS")
    manifest=backup_database(cfg(),stage)
    raw=Path(manifest["path"])
    demand(raw.is_file() and raw.stat().st_size>100000,"NATIVE_BACKUP_EMPTY")
    demand(digest(raw)==manifest["sha256"],"NATIVE_DUMP_SHA_MISMATCH")
    after=live_finance()
    demand(before==after,"LIVE_FINANCE_CHANGED_DURING_DUMP")
    demand(live_schema()==(69,49),"LIVE_SCHEMA_CHANGED_POSTBACKUP")
    record={"schema":"prhm.u06.native-live-backup.v1","run_id":run_id,
            "approval_id":approval_id,"backup_sha256":manifest["sha256"],
            "backup_bytes":raw.stat().st_size,"source_finance":before,
            "source_tables":69,"source_fk":49,
            "live_finance_stable":True,"adapter_sha256":ADAPTER_SHA}
    write_json(d,"native-evidence.json",record)
    return {"backup_sha256":record["backup_sha256"],"backup_bytes":record["backup_bytes"],
            "source_finance_stable":True}

def container_query(name,query):
    return run(["/usr/bin/docker","exec",name,"mariadb","-uroot","-N","-B",
                "--execute="+query],timeout=45,max_output=4000).decode().strip()

def restored_stats(name):
    values={table:container_query(name,"SELECT COUNT(*),COALESCE(SUM("+column+"),0) FROM honartik_db."+table)
            for table,column in FINANCE.items()}
    tables=int(container_query(name,"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=0x686f6e617274696b5f6462 AND table_type=0x42415345205441424c45"))
    fk=int(container_query(name,"SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=0x686f6e617274696b5f6462"))
    return values,tables,fk

def isolated_import(name,image,sql_file,expected_finance):
    name=str(name)
    demand(re.fullmatch(r"u06-native-restore-[0-9a-f]{12}",name) is not None,"SANDBOX_NAME")
    demand(re.fullmatch(r"(mariadb|mysql):[a-zA-Z0-9_.-]+@sha256:[0-9a-f]{64}",image) is not None,"SANDBOX_IMAGE")
    run(["/usr/bin/docker","run","-d","--name",name,"--network=none",
         "--memory=2g","--cpus=1.5","--pids-limit=256",
         "--security-opt=no-new-privileges","--label","prhm.u06.sandbox=1",
         "-e","MYSQL_ALLOW_EMPTY_PASSWORD=yes",image],timeout=150,max_output=1000)
    try:
        for _ in range(90):
            try:
                daemon=run(["/usr/bin/docker","exec",name,"cat","/proc/1/comm"],timeout=5,max_output=100).decode().strip()
                if daemon in ("mysqld","mariadbd"):
                    run(["/usr/bin/docker","exec",name,"mariadb-admin","ping","-uroot"],timeout=6,max_output=500)
                    break
            except (RuntimeError,subprocess.TimeoutExpired):
                pass
            time.sleep(1)
        else: fail("RESTORE_SANDBOX_NOT_READY")
        run(["/usr/bin/docker","exec",name,"mariadb","-uroot","-e",
             "CREATE DATABASE honartik_db"],timeout=20,max_output=500)
        with open(sql_file,"rb") as f:
            p=subprocess.Popen(["/usr/bin/docker","exec","-i",name,"mariadb",
               "-uroot","honartik_db"],stdin=subprocess.PIPE,
               stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            try:
                while True:
                    buf=f.read(1024*1024)
                    if not buf:break
                    p.stdin.write(buf)
                p.stdin.close()
                demand(p.wait(timeout=1200)==0,"RESTORE_SQL_IMPORT_FAILED")
            finally:
                if p.poll() is None:p.kill();p.wait()
        totals,tables,fks=restored_stats(name)
        demand(tables==69 and fks==49,"RESTORE_69_49_DRIFT")
        demand(totals==expected_finance,"FINANCE_COUNTS_OR_AMOUNTS_MISMATCH")
        run(["/usr/bin/docker","exec",name,"mariadb-check","-uroot","--check",
             "honartik_db"],timeout=300,max_output=20000)
        return {"tables":tables,"foreign_keys":fks,"finance_parity":True,"mysqlcheck":True}
    finally:
        run(["/usr/bin/docker","rm","-fv",name],timeout=100,max_output=2000)

def verify_native(run_id,approval_id):
    require_active(run_id,approval_id)
    d=ensure_archive_directory(run_id)
    evidence=json_trusted(d/"native-evidence.json")
    demand(evidence["run_id"]==run_id and evidence["approval_id"]==approval_id,
           "BACKUP_EVIDENCE_BINDING")
    archive=d/"native"/"snapshot"
    demand(digest(archive)==evidence["backup_sha256"],"ARCHIVE_SHA_DRIFT")
    manifest=json_trusted(d/"native"/"manifest.json")
    c=cfg()
    _,verify=installed()
    result=verify(c,manifest,d/"native-verified")
    demand(result.get("verified") is True and result.get("tables")==69,
           "ADAPTER_VERIFY_RESTORE_FAILED")
    restored=isolated_import("u06-native-restore-"+uuid.uuid4().hex[:12],
      c["sandbox"]["image"],archive,evidence["source_finance"])
    write_json(d,"native-verified-evidence.json",{
      "schema":"prhm.u06.native-isolated-finance-restore.v1",
      "backup_sha256":evidence["backup_sha256"],
      "universal_restore_verified":True,"restored_tables":69,"restored_fk_count":49,
      "source_finance_unchanged":True,"full_mysqlcheck_pass":True,
      "finance_tables":sorted(FINANCE),**restored
    })
    return {"restored_tables":69,"restored_fk_count":49,"finance_parity":True,
            "mysqlcheck":True,"backup_sha256":evidence["backup_sha256"]}

def restic_env():
    trusted(RESTIC,RESTIC_SHA,max_bytes=60000000)
    for file in (RESTIC_PASSFILE,SSH_CONFIG,SSH_HOSTS,SSH_ID):
        trusted(file,mode=0o600,max_bytes=200000)
    env={"PATH":"/usr/sbin:/usr/bin:/sbin:/bin","HOME":"/nonexistent",
         "RESTIC_REPOSITORY":REPO,"RESTIC_PASSWORD_FILE":str(RESTIC_PASSFILE),
         "LC_ALL":"C"}
    return env

def native_offsite(run_id,approval_id):
    require_active(run_id,approval_id)
    d=ensure_archive_directory(run_id)
    evidence=json_trusted(d/"native-verified-evidence.json")
    native=json_trusted(d/"native-evidence.json")
    demand(evidence["backup_sha256"]==native["backup_sha256"] and
           evidence["source_finance_unchanged"] is True and
           evidence["full_mysqlcheck_pass"] is True,"NATIVE_NOT_VERIFIED")
    archive=d/"native"/"snapshot"
    demand(digest(archive)==native["backup_sha256"],"NATIVE_SHA_DRIFT")
    env=restic_env()
    opts=["-o","sftp.command="+SFTP_COMMAND]
    # Existing restricted repository is used without modifying its credentials.
    run([str(RESTIC),*opts,"snapshots","--json"],timeout=100,max_output=2000000,env=env)
    out=run([str(RESTIC),*opts,"backup","--json",
             "--tag","prhm-u06-native-v1","--tag","run-"+run_id,
             str(d/"native")],timeout=3600,max_output=10000000,env=env)
    snapshots=[]
    for line in out.decode().splitlines():
        if not line.startswith("{"): continue
        try: message=json.loads(line)
        except ValueError: continue
        if message.get("message_type")=="summary": snapshots.append(message)
    demand(len(snapshots)==1,"REMOTE_RECEIPT_INVALID")
    snap=snapshots[0].get("snapshot_id")
    demand(isinstance(snap,str) and re.fullmatch(r"[0-9a-f]{64}",snap),
           "REMOTE_SNAPSHOT_ID_INVALID")
    with tempfile.TemporaryDirectory(prefix="prhm-u06-native-restic-",
                                    dir="/var/tmp") as tmp:
        p=Path(tmp)
        p.chmod(0o700)
        run([str(RESTIC),*opts,"restore",snap,"--target",tmp],
            timeout=3600,max_output=50000,env=env)
        relative=archive.relative_to("/")
        reloaded=p/relative
        demand(reloaded.is_file() and digest(reloaded)==native["backup_sha256"],
               "REMOTE_NATIVE_ARCHIVE_SHA_MISMATCH")
        # Independent FROM-NODE1 full DB restore and finance check.
        checked=isolated_import("u06-native-restore-"+uuid.uuid4().hex[:12],
           cfg()["sandbox"]["image"],reloaded,native["source_finance"])
    report={
      "schema":"prhm.u06.native-node1-offsite-recovered.v1",
      "run_id":run_id,"restic_snapshot_id":snap,"backup_sha256":native["backup_sha256"],
      "fresh_node1_upload":True,"full_restic_restore":True,
      "remote_dump_sha256_matches":True,"remote_independent_69_table_restore":True,
      **checked
    }
    write_json(d,"native-node1-offsite-evidence.json",report)
    return {"remote_restic_snapshot_id":snap,"node1_restored":True,
            "full_finance_parity":True}

if __name__=="__main__":
    raise SystemExit("NO DIRECT ROOT WORKER CLI. Call only after installed U06 Root-v2 L4 authorization.")
