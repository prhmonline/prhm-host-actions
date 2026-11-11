#!/usr/bin/env python3
"""Exact-scope, root-only Honartik FINANCE RECOVERY rehearsal. NEVER DEPLOYS.

Uses the already-installed, SHA-verified root-owned routine RESTORE implementation
for its isolated MariaDB container only. Does not call its deploy/prepare main(),
does not change sudo, invoke app runner, publish ordinary release attestations
or modify production databases/payment feature flags. Its evidence always says
finance_release_authorized=false; an independently reviewed bounded release
executor and rollback preimage remain mandatory.
"""
import argparse
import datetime as dt
import fcntl
import gzip
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

HOST="prhm-production.prhm.ir"
ROOT="/root/prhm-dev/audit"
APP=Path("/home/honartik/domains/dashboard.honartik.ir/public_html")
MIRROR=Path("/home/honartik/git/honartik-dashboard-honartik-ir.git")
BASE="4ac602e874a128c3328f27f3dab473857512cdbf"
TARGET="d1a64e640c9c2cf4788d55566c17728be5813941"
OWNER_WORKFLOW="4410fc559c15690e7cdaa68884f9bda642e68dbe"
OWNER_RECEIPTS=Path("/var/lib/prhm-honartik-finance-owner/consumed")
BACKUP_ROOT=Path("/var/backups/prhm-central")
BACKUP_REL="db/prhm-mariadb/honartik_db.sql.gz"
HELPER=Path("/usr/local/libexec/deploy-control/honartik-backend-prepare")
HELPER_SHA256="bb6d94b1db5babef628876a41c66178b046f1e983e4a0612700cea55dadb1b61"
OUT_DIR=Path("/var/lib/prhm-honartik-finance-recovery")
LOCK=OUT_DIR/"finance-preflight.lock"
SHA40=re.compile(r"^[a-f0-9]{40}$")
SNAP=re.compile(r"^20[0-9]{6}T[0-9]{6}Z$")
EXPECTED={
 ".github/workflows/honartik-live-reconcile-contract.yml":"A",
 "app/modules/api/controllers/IticketCheckoutCallbackController.php":"M",
 "app/modules/api/controllers/IticketCheckoutController.php":"M",
 "app/modules/iticket/controllers/AdminController.php":"M",
 "app/modules/iticket/services/IticketCheckoutService.php":"M",
 "app/modules/iticket/services/IticketProviderStatusRetry.php":"A",
 "app/modules/iticket/services/IticketVerifiedBankCompensation.php":"A",
 "app/modules/iticket/services/IticketWalletCheckoutService.php":"A",
 "app/modules/iticket/services/ReservationAdminService.php":"M",
 "app/modules/iticket/views/admin/reservation-view.php":"M",
 "app/modules/iticket/views/admin/reservations.php":"M",
 "app/tests/contract/IticketPaymentRecoveryContract.php":"A",
 "app/tests/contract/IticketWalletCheckoutContract.php":"A",
 "docs/HONARTIK_BACKEND_ANCESTRY_RECONCILE_20261111.md":"A",
 "docs/ITICKET_WALLET_COMPENSATION_PILOT_20261110.md":"A",
}
class Blocked(Exception):pass
def need(ok,reason):
 if not ok: raise Blocked(reason)
def subprocess_bytes(*args,timeout=50):
 p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout,check=False)
 need(p.returncode==0,"external_verification_failure")
 return p.stdout
def git(*args):
 return subprocess_bytes("/usr/bin/git","--git-dir="+str(MIRROR),*args)
def root_trusted(p,directory=False,mode=None):
 st=p.lstat()
 need(not p.is_symlink() and st.st_uid==0 and
      (stat.S_ISDIR(st.st_mode) if directory else stat.S_ISREG(st.st_mode)),
      "untrusted_root_path")
 if mode is not None: need((st.st_mode&0o777)==mode,"unsafe_root_mode")
 else: need(not(st.st_mode&0o022),"group_or_world_writable")
 return st
def validate_exact_delta(delta):
 need(delta==EXPECTED,"unreviewed_finance_delta")
 need(len(delta)==15,"unexpected_finance_file_count")
 return len(delta)
def decode_delta(raw):
 parts=raw.decode("utf-8","strict").split("\0")
 need(parts[-1]=="","incomplete_git_delta")
 parts.pop()
 need(len(parts)%2==0,"malformed_delta")
 items={}
 for i in range(0,len(parts),2):
  status,path=parts[i:i+2]
  need(status in ("M","A") and path and path not in items and
       not path.startswith("/") and ".." not in Path(path).parts,
       "unsafe_git_delta")
  items[path]=status
 return items
def validate_source():
 need(MIRROR.is_dir() and not MIRROR.is_symlink(),"missing_backend_mirror")
 for sha in (BASE,TARGET):
  need(git("cat-file","-t",sha).strip()==b"commit","missing_reviewed_commit")
 subprocess_bytes("/usr/bin/git","--git-dir="+str(MIRROR),
                 "merge-base","--is-ancestor",BASE,TARGET)
 delta=decode_delta(git("diff","--name-status","--no-renames","-z",BASE,TARGET))
 return validate_exact_delta(delta)
def validate_owner_receipt(data):
 need(data.get("schema")=="prhm.honartik.finance-owner-identity-consumed.v1",
      "unrecognized_owner_receipt")
 need(data.get("operation")=="honartik_back.production.finance_release" and
      data.get("source_sha")==TARGET and
      data.get("production_base_sha")==BASE and
      data.get("workflow_sha")==OWNER_WORKFLOW,
      "owner_identity_scope_drift")
 for name in ("jti_sha256","challenge_sha256","intent_digest"):
  need(bool(re.fullmatch(r"[a-f0-9]{64}",str(data.get(name,"")))),
       "missing_receipt_digest")
 need(re.fullmatch(r"[0-9]{1,20}",str(data.get("run_id",""))),
      "missing_official_run_identity")
 return data["run_id"]
def inspect_receipt():
 root_trusted(OWNER_RECEIPTS,True,0o700)
 receipts=list(OWNER_RECEIPTS.iterdir())
 need(len(receipts)==1,"owner_identity_receipt_count_not_one")
 root_trusted(receipts[0],False,0o600)
 return validate_owner_receipt(json.loads(receipts[0].read_text("utf-8")))
def inspect_live():
 need(os.geteuid()==0,"root_operator_required")
 need(subprocess_bytes("/usr/bin/hostname","-f").strip().decode()==HOST,
      "wrong_production_host")
 need(APP.is_dir() and not APP.is_symlink(),"bad_app_path")
 actual=subprocess_bytes("/usr/bin/git","-C",str(APP),"rev-parse","HEAD").strip().decode()
 need(actual==BASE,"production_base_changed")
 # Do not silently overwrite app modifications or untracked customer media.
 tracked=subprocess_bytes("/usr/bin/git","-C",str(APP),"status",
                          "--porcelain=v1","--untracked-files=no")
 need(not tracked,"tracked_production_tree_dirty")
 for flag in ("/etc/honartik/iticket-wallet.enabled",
              "/etc/honartik/iticket-auto-compensation.enabled"):
  need(not os.path.lexists(flag),"payment_feature_flag_enabled")
 return actual
def select_fresh_backup(now):
 root_trusted(BACKUP_ROOT,True,0o700)
 candidates=sorted((p for p in BACKUP_ROOT.iterdir()
                    if p.is_dir() and not p.is_symlink() and SNAP.fullmatch(p.name)),
                   reverse=True)
 for snapshot in candidates:
  t=dt.datetime.strptime(snapshot.name,"%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
  age=(now-t).total_seconds()
  if age < -120: continue
  if age > 2700: break
  root_trusted(snapshot,True)
  root_trusted(snapshot/'db',True)
  root_trusted(snapshot/'db/prhm-mariadb',True)
  archive=snapshot/BACKUP_REL
  manifest=snapshot/"SHA256SUMS"
  complete=snapshot/"COMPLETE"
  for p in (archive,manifest,complete):root_trusted(p)
  need(archive.stat().st_size>20000 and archive.stat().st_size<20*1024**3,
       "archive_size_invalid")
  matches=[]
  for line in manifest.read_text("utf-8").splitlines():
   m=re.fullmatch(r"([a-f0-9]{64})  \*?(?:\./)?(.+)",line)
   if m and m.group(2)==BACKUP_REL:matches.append(m.group(1))
  need(len(matches)==1,"archive_manifest_entry_ambiguous")
  with archive.open("rb") as stream:
   actual=hashlib.file_digest(stream,"sha256").hexdigest()
  need(actual==matches[0],"backup_manifest_digest_mismatch")
  bytes_uncompressed=0
  with gzip.open(archive,"rb") as src:
   while chunk:=src.read(1024*1024):bytes_uncompressed+=len(chunk)
  need(bytes_uncompressed>archive.stat().st_size,
       "invalid_gzip_or_empty_sql")
  return snapshot.name,archive,actual,bytes_uncompressed
 raise Blocked("no_fresh_complete_backup")
def load_pinned_restore_helper():
 root_trusted(HELPER)
 need(hashlib.sha256(HELPER.read_bytes()).hexdigest()==HELPER_SHA256,
      "root_restore_implementation_unreviewed")
 loader=importlib.machinery.SourceFileLoader("prhm_finance_pinned_existing_restore",str(HELPER))
 spec=importlib.util.spec_from_loader(loader.name,loader)
 module=importlib.util.module_from_spec(spec)
 loader.exec_module(module)
 need(module.IMAGE=="mariadb:10.11@sha256:7f22313fc130a377a44999965bcb0a08dd5b21e8502824c1b864f792f9bc66ab",
      "isolation_image_changed")
 return module
def check_finance_restored_database(h,container):
 def q(sql):
  result=h.docker("exec",container,"mariadb","-uroot","--batch",
                  "--skip-column-names","-e",sql,timeout=60).strip()
  try:return int(result)
  except (ValueError,TypeError):raise Blocked("invalid_finance_sql_count")
 required={"iticket_checkout","iticket_reservation","finance_wallet","finance_transactions"}
 quoted=",".join("'"+n+"'" for n in sorted(required))
 count=q("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='honartik_db' AND table_name IN ("+quoted+")")
 need(count==len(required),"restored_finance_tables_missing")
 wallet=q("SELECT COUNT(*) FROM honartik_db.finance_wallet")
 checkouts=q("SELECT COUNT(*) FROM honartik_db.iticket_checkout")
 need(wallet>0 and checkouts>0,"restored_finance_rows_missing")
 duplicate_credits=q("""SELECT COUNT(*) FROM (
 SELECT c.id FROM honartik_db.iticket_checkout c
 LEFT JOIN honartik_db.finance_wallet w
 ON w.bank_transaction_id=CAST(c.transaction_id AS CHAR)
 WHERE c.status='compensated_to_wallet'
 GROUP BY c.id
 HAVING COUNT(w.id)!=1 OR
 COALESCE(SUM(w.user_id=c.user_id AND w.amount=c.amount_toman),0)!=1
 ) x""")
 need(duplicate_credits==0,"compensated_wallet_credit_not_exactly_once")
 duplicate_wallet_markers=q("""SELECT COUNT(*) FROM (
 SELECT metadata FROM honartik_db.finance_wallet
 WHERE metadata LIKE '{\\"iticket_wallet_tid\\":%'
 GROUP BY metadata HAVING COUNT(*)>1
 ) x""")
 need(duplicate_wallet_markers==0,"duplicate_wallet_settlement_marker")
 mismatched_payments=q("""SELECT COUNT(*) FROM honartik_db.iticket_checkout c
 LEFT JOIN honartik_db.finance_transactions t ON t.id=c.transaction_id
 WHERE c.status IN ('completed','compensated_to_wallet')
 AND (t.id IS NULL OR t.transactioner<>c.user_id OR t.amount<>c.amount_toman)""")
 need(mismatched_payments==0,"existing_completed_payments_inconsistent")
 return {"restored_wallet_rows":wallet,"restored_checkouts":checkouts,
         "compensated_credit_anomalies":duplicate_credits,
         "duplicate_wallet_markers":duplicate_wallet_markers,
         "completed_payment_mismatches":mismatched_payments}
def perform_isolated_restore(archive):
 h=load_pinned_restore_helper()
 old_probe=h.probe_restored_database
 outcome={}
 def audited_probe(container):
  tables,migrations=old_probe(container)
  outcome.update(check_finance_restored_database(h,container))
  return tables,migrations
 # Plug a read-only SQL probe into the pre-existing network-none restore
 # while the temporary, short-lived container still exists. No live DB access.
 h.probe_restored_database=audited_probe
 tables,migrations=h.restore_isolated(archive)
 need(outcome and tables>=69 and migrations>=1,
      "restore_or_finance_invariants_incomplete")
 return tables,migrations,outcome
def write_evidence(snapshot,digest,owner_run,tables,migrations,stats,now):
 root_trusted(OUT_DIR,True,0o700)
 name="honartik-finance-recovery-"+snapshot+".json"
 dest=OUT_DIR/name
 need(not dest.exists() and not dest.is_symlink(),
      "evidence_already_exists_must_not_reuse")
 evidence={
  "schema":"prhm.honartik.finance.recovery-preflight.v1",
  "status":"pass","host":HOST,"project":"honartik_back",
  "operation":"honartik_back.production.finance_release",
  "production_base_sha":BASE,"source_sha":TARGET,
  "owner_identity_receipt_run_id":owner_run,"snapshot_id":snapshot,
  "backup_sha256":digest,"backup_root_manifest":"pass",
  "fresh_database_restore":"pass","restored_tables":tables,
  "verified_migration_files":migrations,
  "wallet_existing_data_integrity":"pass",
  "wallet_check_counts":stats,
  "feature_flags_off":True,"reviewed_finance_diff_files":15,
  "rollback_preimage_verified":False,
  "bounded_finance_release_executor_installed":False,
  "finance_release_authorized":False,"production_mutated":False,
  "checked_at_utc":now.strftime("%Y-%m-%dT%H:%M:%SZ")
 }
 raw=(json.dumps(evidence,sort_keys=True,separators=(",",":"))+"\n").encode()
 fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:os.write(fd,raw);os.fsync(fd)
 finally:os.close(fd)
 folder=os.open(OUT_DIR,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(folder)
 finally:os.close(folder)
 return name
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("command",choices=("preflight",))
 args=ap.parse_args()
 need(os.geteuid()==0,"root_only")
 os.umask(0o077)
 now=dt.datetime.now(dt.timezone.utc)
 need(bool(re.fullmatch("[0-9a-f]{40}",os.environ.get("REVIEWED_SOURCE_SHA",""))),
      "reviewed_source_sha_required")
 # Source checkout must be rooted in an immutable exact-SHA clean Git tree.
 src=Path(__file__).resolve().parents[1]
 sha=subprocess_bytes("/usr/bin/git","-C",str(src),"rev-parse","HEAD").strip().decode()
 need(sha==os.environ["REVIEWED_SOURCE_SHA"],"source_git_pin_mismatch")
 need(not subprocess_bytes("/usr/bin/git","-C",str(src),
                           "status","--porcelain","--untracked-files=all"),
      "source_checkout_dirty")
 # Revalidate exact source and installed owner before touching backup/containers.
 owner=inspect_receipt()
 inspect_live()
 validate_source()
 root_trusted(LOCK.parent,True)
 with LOCK.open("a+") as f:
  fcntl.flock(f.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
  snapshot,archive,digest,raw_size=select_fresh_backup(now)
  print("FINANCE_FRESH_BACKUP=PASS snapshot="+snapshot+" sha256="+digest,flush=True)
  print("BACKUP_SQL_DECOMPRESSED_BYTES="+str(raw_size),flush=True)
  tables,migrations,stats=perform_isolated_restore(archive)
  inspect_live()
  print("FINANCE_ISOLATED_RESTORE=PASS tables="+str(tables)+
        " migrations="+str(migrations),flush=True)
  print("FINANCE_WALLET_EXISTING_DATA_CHECKS="+json.dumps(stats,sort_keys=True),flush=True)
  evidence=write_evidence(snapshot,digest,owner,tables,migrations,stats,dt.datetime.now(dt.timezone.utc))
  print("ROOT_PRIVATE_RECOVERY_EVIDENCE="+str(OUT_DIR/evidence),flush=True)
  print("FINANCE_RECOVERY_PREFLIGHT=PASS",flush=True)
  print("FINANCE_RELEASE_AUTHORIZED=FALSE",flush=True)
 return 0
def safe_failure_label(error):
 if isinstance(error,Blocked):
  return str(error)
 if isinstance(error,RuntimeError):
  # Importer's fixed refusal reason only; never print SQL, rows or credentials.
  code=str(error).split(':',1)[0]
  return code if re.fullmatch(r'[a-z][a-z0-9_]{2,79}',code) else 'unclassified_runtime_error'
 return type(error).__name__

if __name__=="__main__":
 try:raise SystemExit(main())
 except (Blocked,ValueError,KeyError,FileNotFoundError,OSError,subprocess.TimeoutExpired,
         ImportError,RuntimeError,BlockingIOError) as e:
  label=safe_failure_label(e)
  print("FINANCE_RECOVERY_PREFLIGHT=BLOCKED reason="+label,file=sys.stderr)
  raise SystemExit(2)
