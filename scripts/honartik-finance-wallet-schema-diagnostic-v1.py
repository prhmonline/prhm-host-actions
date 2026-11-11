#!/usr/bin/env python3.11
"""Honartik wallet release diagnostic: exact reviewed source + offline DB schema.

READ-ONLY on the live application/database. Restores a pinned historical
backup into an ephemeral MariaDB instance with --network none, tests only
the tables used by the candidate iTicket wallet/compensation path, and
issues a separate root-only *diagnostic*, never a release attestation.
An empty Yii migration ledger remains UNPROVEN; no legacy migrations run.
"""
import datetime as dt
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
BASE="4ac602e874a128c3328f27f3dab473857512cdbf"
FRONT="1d8f9c30bda4ab8aab8d87b00e978890aa60efe9"
TARGET="d1a64e640c9c2cf4788d55566c17728be5813941"
APP=Path("/home/honartik/domains/dashboard.honartik.ir/public_html")
FRONT_APP=Path("/home/honartik/domains/honartik.ir/public_html")
SNAPSHOT=Path("/var/backups/prhm-central/20261111T092019Z")
ARCHIVE=SNAPSHOT/"db/prhm-mariadb/honartik_db.sql.gz"
ARCHIVE_SHA="5adf9397c2cbc8045d29ef7b11bd34ab17ed26a4920106a79f036fa24e85de15"
HELPER=Path("/usr/local/libexec/deploy-control/honartik-backend-prepare")
HELPER_SHA="bb6d94b1db5babef628876a41c66178b046f1e983e4a0612700cea55dadb1b61"
IMAGE="mariadb:10.11@sha256:7f22313fc130a377a44999965bcb0a08dd5b21e8502824c1b864f792f9bc66ab"
REPORTS=Path("/var/lib/prhm-honartik-finance-recovery")
MANIFEST_REL="evidence/honartik/finance-wallet-frozen-yii54-20261111.json"
EXPECTED_COLUMNS={
"user":{"id"},
"finance_transactions":{"id","transactioner","amount","status","gateway","gateway_reciept","gateway_meta","internal_meta","additional_rows"},
"finance_wallet":{"id","created_at","user_id","amount","transactioner","transactioner_ip","bank_transaction_id","description","metadata"},
"iticket_checkout":{"id","user_id","provider_order_id","schedule_id","provider_amount","amount_toman","transaction_id","status","bank_receipt","review_reason","provider_status","updated_at"},
"iticket_reservation":{"id","provider_order_id","status","updated_at"},
"iticket_sms_outbox":{"id","provider_order_id","user_id","event_type","status"},
}
INDEX_PREFIXES={
"finance_wallet":{"user_id","bank_transaction_id"},
"iticket_checkout":{"transaction_id","provider_order_id"},
"iticket_reservation":{"provider_order_id"},
"iticket_sms_outbox":{"provider_order_id"},
}
class Blocked(Exception):pass
def need(cond,reason):
 if not cond:raise Blocked(reason)
def trusted(path,directory=False,mode=None):
 st=path.lstat()
 need(not path.is_symlink() and st.st_uid==0 and
      (stat.S_ISDIR(st.st_mode) if directory else stat.S_ISREG(st.st_mode)),
      "untrusted_root_path")
 if mode is not None:need(stat.S_IMODE(st.st_mode)==mode,"unsafe_path_mode")
 else:need((st.st_mode&0o022)==0,"writable_root_file")
def sha_file(path):
 with path.open("rb") as f:return hashlib.file_digest(f,"sha256").hexdigest()
def run(*args):
 p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=35)
 need(p.returncode==0,"source_pin_command_failed")
 return p.stdout.decode("utf-8").strip()
def clean_source(source,pin):
 need(re.fullmatch(r"[a-f0-9]{40}",pin or ""), "source_sha_unpinned")
 need(run("/usr/bin/git","-C",str(source),"rev-parse","HEAD")==pin,
      "source_checkout_head_drift")
 need(not run("/usr/bin/git","-C",str(source),"status","--porcelain","--untracked-files=all"),
      "source_checkout_dirty")
def validate_manifest(manifest,root=APP):
 need(manifest.get("schema")=="prhm.honartik.finance.wallet-isolated-schema-review.v1",
      "manifest_schema_drift")
 need(manifest.get("live_base_sha")==BASE and manifest.get("finance_candidate_sha")==TARGET,
      "manifest_source_mismatch")
 for flag in ("allow_any_historical_migration_replay","allow_migration_ledger_stamping",
              "production_migration_authorized","production_release_authorized"):
  need(manifest.get(flag) is False,"manifest_must_forbid_mutation")
 files=manifest.get("migration_files")
 need(isinstance(files,list) and len(files)==54 and
      manifest.get("required_migration_count")==54,"migration_inventory_not_54")
 cfg=manifest.get("config_sha256")
 need(isinstance(cfg,dict) and len(cfg)==6,"config_inventory_incomplete")
 seen=set()
 for item in files:
  version,path,sha=item.get("version"),item.get("path"),item.get("sha256")
  need(isinstance(version,str) and isinstance(path,str) and isinstance(sha,str)
       and re.fullmatch(r"m[0-9]{6}_[0-9]{6}_[A-Za-z0-9_]+",version)
       and re.fullmatch(r"[a-f0-9]{64}",sha) and
       Path(path).name==version+".php" and
       not Path(path).is_absolute() and ".." not in Path(path).parts
       and version not in seen,"untrusted_migration_record")
  seen.add(version)
  p=root/path
  need(p.is_file() and not p.is_symlink() and sha_file(p)==sha,
       "historical_migration_file_drift")
 for path,sha in cfg.items():
  need(isinstance(path,str) and not Path(path).is_absolute() and
       ".." not in Path(path).parts and
       isinstance(sha,str) and re.fullmatch(r"[a-f0-9]{64}",sha),
       "untrusted_migration_config")
  p=root/path
  need(p.is_file() and not p.is_symlink() and sha_file(p)==sha,
       "yii_discovery_config_drift")
 return len(seen)
def validate_archive():
 for folder in (SNAPSHOT.parent,SNAPSHOT,SNAPSHOT/"db",SNAPSHOT/"db/prhm-mariadb"):
  trusted(folder,True)
 for f in (ARCHIVE,SNAPSHOT/"COMPLETE",SNAPSHOT/"SHA256SUMS"):trusted(f)
 need(sha_file(ARCHIVE)==ARCHIVE_SHA,"archive_sha_mismatch")
 hits=[]
 for line in (SNAPSHOT/"SHA256SUMS").read_text("utf-8").splitlines():
  m=re.fullmatch(r"([a-f0-9]{64})  \*?(?:\./)?(.+)",line)
  if m and m.group(2)=="db/prhm-mariadb/honartik_db.sql.gz":hits.append(m.group(1))
 need(hits==[ARCHIVE_SHA],"backup_manifest_digest_untrusted")
 # The restore helper decompresses the whole SQL stream; this verifies gzip
 # readability independently before allowing the isolated DB container.
 total=0
 with gzip.open(ARCHIVE,"rb") as inp:
  for b in iter(lambda:inp.read(1024*1024),b""):total+=len(b)
 need(total>400000000,"archive_uncompressed_truncated")
 return total
def check_column_inventory(lines):
 found={name:set() for name in EXPECTED_COLUMNS}
 for line in lines:
  fields=line.split("\t")
  need(len(fields)==2,"schema_column_inventory_invalid")
  table,col=fields
  if table in found:found[table].add(col)
 for table,cols in EXPECTED_COLUMNS.items():
  need(cols<=found[table],"wallet_required_schema_column_missing_"+table)
 return {k:len(v) for k,v in found.items()}
def check_index_inventory(lines):
 present={t:set() for t in INDEX_PREFIXES}
 for line in lines:
  fields=line.split("\t")
  need(len(fields)==3,"schema_index_inventory_invalid")
  table,seq,col=fields
  if table in present and seq=="1":present[table].add(col)
 for table,required in INDEX_PREFIXES.items():
  need(required<=present[table],"wallet_required_index_missing_"+table)
 return {k:sorted(v) for k,v in present.items()}
def query(h,container,sql):
 need(sql.startswith("SELECT ") and "\n" not in sql and ";" not in sql and
      not re.search(r"\b(INTO|OUTFILE|LOAD_FILE|SLEEP|BENCHMARK|FOR UPDATE)\b",sql,re.I),
      "non_read_only_sql_refused")
 return h.docker("exec",container,"mariadb","-uroot",
                 "--batch","--skip-column-names","-e",sql,timeout=60)
def scalar(h,container,sql):
 value=query(h,container,sql).strip()
 need(re.fullmatch(r"[0-9]+",value),"non_numeric_finance_probe")
 return int(value)
def inspect_offline_finance(h,container):
 cols=query(h,container,"SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='honartik_db'").splitlines()
 checked_cols=check_column_inventory(cols)
 indexes=query(h,container,"SELECT TABLE_NAME,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='honartik_db'").splitlines()
 checked_indexes=check_index_inventory(indexes)
 tables=scalar(h,container,"SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='honartik_db'")
 need(tables>=69,"isolated_restore_incomplete")
 ledger=scalar(h,container,"SELECT COUNT(*) FROM honartik_db.system_db_migration")
 need(ledger==0,"historical_yii_ledger_changed_from_snapshot")
 wallet=scalar(h,container,"SELECT COUNT(*) FROM honartik_db.finance_wallet")
 checkout=scalar(h,container,"SELECT COUNT(*) FROM honartik_db.iticket_checkout")
 need(wallet>0 and checkout>0,"missing_existing_wallet_or_checkout_rows")
 compensated=scalar(h,container,"SELECT COUNT(*) FROM honartik_db.iticket_checkout WHERE status='compensated_to_wallet'")
 anomalies=scalar(h,container,"SELECT COUNT(*) FROM honartik_db.iticket_checkout c WHERE c.status='compensated_to_wallet' AND (SELECT COUNT(*) FROM honartik_db.finance_wallet w WHERE w.bank_transaction_id=CAST(c.transaction_id AS CHAR) AND w.user_id=c.user_id AND w.amount=c.amount_toman)<>1")
 need(anomalies==0,"compensation_primary_credit_integrity_failed")
 duplicate_markers=scalar(h,container,"SELECT COUNT(*) FROM (SELECT metadata FROM honartik_db.finance_wallet WHERE metadata LIKE '{\"iticket_wallet_tid\":%' GROUP BY metadata HAVING COUNT(*)>1) z")
 need(duplicate_markers==0,"duplicate_wallet_ledger_marker")
 wrong_finance=scalar(h,container,"SELECT COUNT(*) FROM honartik_db.iticket_checkout c JOIN honartik_db.finance_transactions t ON t.id=c.transaction_id WHERE c.status='compensated_to_wallet' AND (t.transactioner<>c.user_id OR t.amount<>c.amount_toman)")
 need(wrong_finance==0,"compensated_transaction_amount_or_owner_drift")
 h.docker("exec",container,"mariadb-check","-uroot","--check","honartik_db",timeout=180)
 return {"restored_tables":tables,"yii_history_rows":ledger,
         "wallet_rows":wallet,"checkout_rows":checkout,
         "compensated_checkout_rows":compensated,
         "compensation_primary_credit_anomalies":anomalies,
         "duplicate_wallet_ledger_markers":duplicate_markers,
         "compensation_payment_mismatches":wrong_finance,
         "required_column_counts":checked_cols,"first_index_columns":checked_indexes,
         "isolated_mysqlcheck":"pass"}
def source_preflight(source):
 path=source/"scripts/honartik-finance-recovery-preflight-v1.py"
 spec=importlib.util.spec_from_file_location("finance_existing_source_guard",path)
 m=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(m)
 need(m.BASE==BASE and m.TARGET==TARGET,"source_baseline_drift")
 m.validate_source()
 m.inspect_live()
 need(run("/usr/bin/git","-C",str(FRONT_APP),"rev-parse","HEAD")==FRONT,
      "frontend_production_drift")
def import_helper():
 trusted(HELPER)
 need(sha_file(HELPER)==HELPER_SHA,"unreviewed_root_restore_helper")
 loader=importlib.machinery.SourceFileLoader("honartik_fixed_isolated_restore_wallet",str(HELPER))
 spec=importlib.util.spec_from_loader(loader.name,loader)
 module=importlib.util.module_from_spec(spec)
 loader.exec_module(module)
 need(module.IMAGE==IMAGE,"isolation_image_drift")
 return module
def write_private_report(data):
 trusted(REPORTS,True,0o700)
 name="honartik-finance-wallet-schema-only-20261111T092019Z.json"
 path=REPORTS/name
 need(not path.exists() and not path.is_symlink(),"existing_report_must_not_overwrite")
 raw=(json.dumps(data,sort_keys=True,separators=(",",":"))+"\n").encode()
 fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 try:os.write(fd,raw);os.fsync(fd)
 finally:os.close(fd)
 d=os.open(REPORTS,os.O_DIRECTORY|os.O_RDONLY)
 try:os.fsync(d)
 finally:os.close(d)
 return name
def main():
 os.umask(0o077)
 need(os.geteuid()==0 and run("/usr/bin/hostname","-f")==HOST,
      "trusted_root_host_required")
 source=Path(__file__).resolve().parents[1]
 clean_source(source,os.environ.get("REVIEWED_SOURCE_SHA"))
 manifest_path=source/MANIFEST_REL
 manifest=json.loads(manifest_path.read_text("utf-8"))
 frozen=validate_manifest(manifest)
 source_preflight(source)
 raw_len=validate_archive()
 h=import_helper()
 holder={}
 def probe(container):
  holder.update(inspect_offline_finance(h,container))
  return holder["restored_tables"],frozen
 h.probe_restored_database=probe
 print("FROZEN_54_YII_FILES=PASS",flush=True)
 print("BACKUP_INTEGRITY=PASS uncompressed_bytes="+str(raw_len),flush=True)
 tables,inventory=h.restore_isolated(ARCHIVE)
 need(tables>=69 and inventory==54 and bool(holder),
      "isolated_wallet_schema_review_incomplete")
 source_preflight(source)
 report={
  "schema":"prhm.honartik.finance.wallet-isolated-schema-only.v1",
  "result":"diagnostic_pass","host":HOST,
  "source_review_sha":os.environ["REVIEWED_SOURCE_SHA"],
  "production_base_sha":BASE,"finance_candidate_sha":TARGET,
  "snapshot_id":SNAPSHOT.name,"snapshot_sha256":ARCHIVE_SHA,
  "source_migration_inventory":"54 exact files matched",
  "historical_yii_migration_proven":False,
  "historical_yii_migration_replay_allowed":False,
  "source_net_migrations_added":False,
  "production_migrations_executed":False,
  "schema_scope":"wallet_and_iticket_only",
  "snapshot_fresh_for_release":False,
  "independent_restore_recovery_attestation_issued":False,
  "bounded_finance_release_executor_installed":False,
  "release_authorized":False,"production_modified":False,
  "financial_feature_flags_enabled":False,
  "finance_probe":holder,
  "checked_at_utc":dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
 }
 name=write_private_report(report)
 print("WALLET_OFFLINE_SCHEMA_DIAGNOSTIC=PASS",flush=True)
 print("REPORT_ROOT_ONLY="+name,flush=True)
 print("PRODUCTION_RELEASE_AUTHORIZED=FALSE",flush=True)
 return 0
if __name__=="__main__":
 try:sys.exit(main())
 except (Blocked,OSError,ValueError,KeyError,TypeError,RuntimeError,
         subprocess.TimeoutExpired,ImportError) as e:
  # No error text from SQL or backup data is surfaced outside root.
  reason=str(e) if isinstance(e,Blocked) else type(e).__name__
  print("WALLET_OFFLINE_SCHEMA_DIAGNOSTIC=BLOCKED reason="+reason,file=sys.stderr)
  print("PRODUCTION_RELEASE_AUTHORIZED=FALSE",file=sys.stderr)
  sys.exit(2)
