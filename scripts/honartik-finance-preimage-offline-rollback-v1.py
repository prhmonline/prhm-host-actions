#!/usr/bin/env python3
"""Root-only Honartik finance *preimage* and offline rollback rehearsal.

Creates private SHA-256-hashed release-relevant app snapshots, restores them
to isolated directories, compares every included byte and tests the installed
fixed rollback helper against a disposable Git checkout. DOES NOT deploy,
restore into production, change Git refs in production, access production DB,
migrate, alter payment flags or issue any finance-release authorization.

This is not a crash-consistent database backup or end-to-end runtime rollback.
"""
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile

HOST="prhm-production.prhm.ir"
BACK=Path("/home/honartik/domains/dashboard.honartik.ir/public_html")
FRONT=Path("/home/honartik/domains/honartik.ir/public_html")
BARE=Path("/home/honartik/git/honartik-dashboard-honartik-ir.git")
BACK_SHA="4ac602e874a128c3328f27f3dab473857512cdbf"
FRONT_SHA="1d8f9c30bda4ab8aab8d87b00e978890aa60efe9"
CANDIDATE="d1a64e640c9c2cf4788d55566c17728be5813941"
HELPER=Path("/usr/local/libexec/deploy-control/honartik-back-rollback-helper")
HELPER_SHA="4f6be075122717a4cb7282bc8e08ebec7609610968cb8b7188d19b55a6c1c8e4"
OUT=Path("/var/lib/prhm-honartik-finance-preimages")
ROOT_AUDIT=Path("/root/prhm-dev/audit")
SOURCE_TEST="scripts/honartik-finance-recovery-preflight-v1.py"
BACK_EXCLUDES=(
    "/runtime/***","/app/runtime/***",
)
FRONT_EXCLUDES=(
    "/.next.building.*","/.next.rollback-*","/.external-stage-*",
    "/.next/cache/***","/.next/trace",
    "/node_modules/.cache/***",
)
class Blocked(Exception):pass
def require(condition,reason):
 if not condition:raise Blocked(reason)
def trusted_root(path,directory=False,mode=None):
 s=path.lstat()
 require(not path.is_symlink() and s.st_uid==0 and
         (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)),
         "untrusted_root_path")
 if mode is not None:require(stat.S_IMODE(s.st_mode)==mode,"unsafe_root_mode")
 else:require((stat.S_IMODE(s.st_mode)&0o022)==0,"writable_root_path")
def sha(path):
 with path.open("rb") as stream:return hashlib.file_digest(stream,"sha256").hexdigest()
def command(*args,timeout=90):
 p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                  timeout=timeout,check=False)
 require(p.returncode==0,"command_failed")
 return p.stdout.decode("utf-8","strict").strip()
def checked_repo(root,expected):
 require(root.is_dir() and not root.is_symlink(),"app_root_invalid")
 require(command("/usr/bin/git","-C",str(root),"rev-parse","HEAD")==expected,
         "production_source_pin_changed")
 require(command("/usr/bin/git","-C",str(root),"status","--porcelain","--untracked-files=no")=="",
         "tracked_production_files_dirty")
def live_fence():
 require(os.geteuid()==0 and command("/usr/bin/hostname","-f")==HOST,
         "wrong_root_host")
 checked_repo(BACK,BACK_SHA)
 checked_repo(FRONT,FRONT_SHA)
 for flag in ("/etc/honartik/iticket-wallet.enabled",
              "/etc/honartik/iticket-auto-compensation.enabled"):
  require(not os.path.lexists(flag),"finance_flag_enabled")
 require(FRONT.joinpath(".next").is_dir() and FRONT.joinpath("node_modules").is_dir(),
         "active_frontend_build_or_dependencies_missing")
def source_fence(source):
 pin=os.environ.get("REVIEWED_SOURCE_SHA","")
 require(bool(re.fullmatch(r"[a-f0-9]{40}",pin)),"source_review_sha_required")
 require(command("/usr/bin/git","-C",str(source),"rev-parse","HEAD")==pin,
         "reviewed_source_pin_mismatch")
 require(command("/usr/bin/git","-C",str(source),"status","--porcelain","--untracked-files=all")=="",
         "reviewed_source_checkout_dirty")
 guard=source/SOURCE_TEST
 spec=importlib.util.spec_from_file_location("finance_preimage_readonly_source_gate",guard)
 module=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(module)
 require(module.BASE==BACK_SHA and module.TARGET==CANDIDATE,
         "finance_candidate_source_scope_drift")
 module.validate_source()
def rsync_args(source,dest,excludes,verify=False):
 # Archive mode preserves permissions, numeric owners, symlinks, and mtimes;
 # --one-file-system forbids traversing new mounts; never follows symlinks.
 args=["/usr/bin/rsync","-aH","--numeric-ids","--one-file-system",
       "--no-devices","--no-specials"]
 if verify:args.extend(["-n","-c","-i","--delete"])
 for ex in excludes:args.append("--exclude="+ex)
 args.extend([str(source)+"/",str(dest)+"/"])
 return args
def copy_one(source,dest,excludes):
 dest.mkdir(mode=0o700)
 output=command(*rsync_args(source,dest,excludes),timeout=1200)
 require(output=="","unexpected_copy_output")
def verify_against_live(source,dest,excludes):
 # Checksum dry-run against source flags a file changing during the snapshot.
 delta=command(*rsync_args(source,dest,excludes,verify=True),timeout=1200)
 require(delta=="","source_changed_during_preimage")
def verify_restored_tree(stage,restored):
 delta=command(*rsync_args(stage,restored,(),verify=True),timeout=1200)
 require(delta=="","isolated_preimage_restore_mismatch")
def count_regular(root):
 total=0
 for base,dirs,files in os.walk(root,followlinks=False):
  for fn in files:
   f=Path(base)/fn
   if f.is_file() and not f.is_symlink():total+=1
 return total
def rollback_git_dry_run(sandbox):
 trusted_root(HELPER)
 require(sha(HELPER)==HELPER_SHA,"rollback_helper_changed")
 require(BARE.is_dir() and not BARE.is_symlink(),"backend_mirror_unavailable")
 for commit in (BACK_SHA,CANDIDATE):
  require(command("/usr/bin/git","--git-dir="+str(BARE),"cat-file","-t",commit)=="commit",
          "reviewed_backend_commit_missing")
 repo=sandbox/"git-rehearsal"
 command("/usr/bin/git","clone","-q","--shared","--no-checkout",str(BARE),str(repo),timeout=180)
 command("/usr/bin/git","-C",str(repo),"checkout","-q","-B","main",CANDIDATE,timeout=180)
 require(command("/usr/bin/git","-C",str(repo),"status","--porcelain","--untracked-files=no")=="",
         "isolated_target_checkout_dirty")
 command("/bin/bash","-c",
         'set -euo pipefail; source "$1"; honartik_back_rollback_checkout "$2" "$3" "$4" >/dev/null',
         "finance_git_rollback_dry_run",str(HELPER),str(repo),BACK_SHA,CANDIDATE,
         timeout=180)
 require(command("/usr/bin/git","-C",str(repo),"rev-parse","HEAD")==BACK_SHA,
         "isolated_rollback_head_wrong")
 require(command("/usr/bin/git","-C",str(repo),"rev-parse","refs/heads/main")==CANDIDATE,
         "isolated_rollback_violated_git_first")
 require(command("/usr/bin/git","-C",str(repo),"branch","--show-current")=="",
         "isolated_rollback_not_detached")
 require(command("/usr/bin/git","-C",str(repo),"status","--porcelain","--untracked-files=no")=="",
         "isolated_rollback_tracked_tree_dirty")
 return True
def create_preimage():
 os.umask(0o077)
 live_fence()
 trusted_root(ROOT_AUDIT,True)
 # Root-only first-time parent creation, no mutations in live app directories.
 if not OUT.exists():OUT.mkdir(mode=0o700)
 trusted_root(OUT,True,0o700)
 lock=OUT/"preimage.lock"
 fd=os.open(lock,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
 try:
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  now=dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
  temp=Path(tempfile.mkdtemp(dir=OUT,prefix=".preimage-inprogress-"))
  temp.chmod(0o700)
  try:
   stage=temp/"source";stage.mkdir(mode=0o700)
   restored=temp/"test-restore";restored.mkdir(mode=0o700)
   copy_one(BACK,stage/"backend",BACK_EXCLUDES)
   copy_one(FRONT,stage/"frontend",FRONT_EXCLUDES)
   live_fence()
   verify_against_live(BACK,stage/"backend",BACK_EXCLUDES)
   verify_against_live(FRONT,stage/"frontend",FRONT_EXCLUDES)
   print("LIVE_SOURCE_PREIMAGE_COPY=PASS",flush=True)
   bundle=temp/"honartik-production-preimage.tar.gz"
   command("/usr/bin/tar","--acls","--xattrs","--numeric-owner",
           "--use-compress-program=pigz -p 2 -1",
           "-cf",str(bundle),"-C",str(stage),"backend","frontend",timeout=1800)
   require(bundle.stat().st_size>1048576,"preimage_archive_truncated")
   archive_hash=sha(bundle)
   print("PREIMAGE_ARCHIVE_SHA256="+archive_hash,flush=True)
   command("/usr/bin/tar","-xzf",str(bundle),"-C",str(restored),timeout=1800)
   verify_restored_tree(stage/"backend",restored/"backend")
   verify_restored_tree(stage/"frontend",restored/"frontend")
   print("ISOLATED_PREIMAGE_BYTE_RESTORE=PASS",flush=True)
   require(rollback_git_dry_run(temp),"isolated_git_rollback_failed")
   print("GIT_FIRST_ROLLBACK_DRY_RUN=PASS",flush=True)
   live_fence()
   metadata={
    "schema":"prhm.honartik.finance.preimage-offline-rollback.v1",
    "host":HOST,"backend_live_sha":BACK_SHA,"frontend_live_sha":FRONT_SHA,
    "finance_candidate_sha":CANDIDATE,
    "release_source_sha":os.environ.get("REVIEWED_SOURCE_SHA"),
    "preimage_archive":"honartik-production-preimage.tar.gz",
    "preimage_sha256":archive_hash,
    "preimage_archive_bytes":bundle.stat().st_size,
    "backend_regular_files":count_regular(stage/"backend"),
    "frontend_regular_files":count_regular(stage/"frontend"),
    "backend_exclusions":list(BACK_EXCLUDES),"frontend_exclusions":list(FRONT_EXCLUDES),
    "media_included_except_declared_exclusions":True,
    "isolated_tar_restore_hash_compare":"pass",
    "isolated_pinned_git_rollback_helper":"pass",
    "rollback_tested_only_offline":True,
    "runtime_cutover_rollback_tested":False,
    "db_rollback_tested":False,
    "historical_yii_ledger_proven":False,
    "independent_fresh_db_restore_for_release":False,
    "finance_release_executor_installed":False,
    "financial_feature_flags_enabled":False,
    "finance_release_authorized":False,
    "production_modified":False,
    "created_at_utc":dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
   }
   report=temp/"preimage-test-report.json"
   with report.open("x",encoding="utf-8") as f:
    json.dump(metadata,f,sort_keys=True,separators=(",",":"))
    f.write("\n");f.flush();os.fsync(f.fileno())
   report.chmod(0o600);bundle.chmod(0o600)
   # Keep only root-private protected proof, never leave a second
   # unencrypted full-data copy or a reusable target-code checkout.
   shutil.rmtree(stage);shutil.rmtree(restored)
   shutil.rmtree(temp/"git-rehearsal")
   final=OUT/("preimage-"+now+"-"+archive_hash[:12])
   require(not final.exists(),"preimage_destination_already_exists")
   os.rename(temp,final)
   print("PREIMAGE_AND_OFFLINE_ROLLBACK=PASS",flush=True)
   print("PRIVATE_REPORT="+str(final/"preimage-test-report.json"),flush=True)
   print("FINANCE_RELEASE_AUTHORIZED=FALSE",flush=True)
   return 0
  finally:
   if temp.exists():shutil.rmtree(temp)
 finally:
  os.close(fd)
if __name__=="__main__":
 try:sys.exit(create_preimage())
 except (Blocked,ValueError,KeyError,FileNotFoundError,OSError,
         subprocess.TimeoutExpired,RuntimeError,ImportError) as ex:
  code=str(ex) if isinstance(ex,Blocked) else type(ex).__name__
  print("PREIMAGE_AND_OFFLINE_ROLLBACK=BLOCKED reason="+code,file=sys.stderr)
  print("FINANCE_RELEASE_AUTHORIZED=FALSE",file=sys.stderr)
  sys.exit(2)
