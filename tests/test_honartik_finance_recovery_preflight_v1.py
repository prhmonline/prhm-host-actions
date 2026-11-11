#!/usr/bin/env python3
"""Synthetic adversarial tests. No live filesystem, DB, Docker or deployment."""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[1]/"scripts/honartik-finance-recovery-preflight-v1.py"
spec=importlib.util.spec_from_file_location("honartik_finance_recovery_preflight_v1",SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Tests(unittest.TestCase):
 def test_fixed_source_financial_scope(self):
  self.assertEqual(len(m.EXPECTED),15)
  self.assertEqual(m.BASE,"4ac602e874a128c3328f27f3dab473857512cdbf")
  self.assertEqual(m.TARGET,"d1a64e640c9c2cf4788d55566c17728be5813941")
  self.assertEqual(m.OWNER_WORKFLOW,"4410fc559c15690e7cdaa68884f9bda642e68dbe")
  self.assertEqual(m.HELPER_SHA256,"bb6d94b1db5babef628876a41c66178b046f1e983e4a0612700cea55dadb1b61")
  self.assertEqual(m.validate_exact_delta(m.EXPECTED),15)
 def test_delta_must_be_identical(self):
  bad=dict(m.EXPECTED)
  bad["app/modules/api/controllers/IticketCheckoutController.php"]="D"
  for obj in (bad,{**m.EXPECTED,"unknown.php":"A"},
              {k:v for k,v in m.EXPECTED.items() if k!="app/modules/iticket/services/IticketWalletCheckoutService.php"},
              {}):
   with self.assertRaises(m.Blocked):m.validate_exact_delta(obj)
 def test_diff_tokens_and_file_path_safety(self):
  good=b"".join((k.encode()+b"\0"+v.encode()+b"\0")
                for k,v in [(s,p) for p,s in m.EXPECTED.items()])
  # Convert to git --name-status -z order.
  good=b"".join(s.encode()+b"\0"+p.encode()+b"\0" for p,s in m.EXPECTED.items())
  self.assertEqual(m.decode_delta(good),m.EXPECTED)
  for invalid in (b"M\0../unsafe\0",b"A\0/root\0",b"M\0name",
                  b"M\0foo\0M\0foo\0",b"R100\0foo\0"):
   with self.assertRaises(m.Blocked):m.decode_delta(invalid)
 def test_owner_receipt_one_use_proof_is_evidence_not_release(self):
  good={"schema":"prhm.honartik.finance-owner-identity-consumed.v1",
        "operation":"honartik_back.production.finance_release",
        "source_sha":m.TARGET,"production_base_sha":m.BASE,
        "workflow_sha":m.OWNER_WORKFLOW,
        "run_id":"42917752557",
        "jti_sha256":"a"*64,"challenge_sha256":"b"*64,"intent_digest":"c"*64}
  self.assertEqual(m.validate_owner_receipt(good),"42917752557")
  for key,value in (("source_sha","0"*40),("workflow_sha","b"*40),
                    ("operation","other"),("challenge_sha256","bad"),
                    ("run_id","1 or 1=1")):
   with self.subTest(key=key),self.assertRaises(m.Blocked):
    m.validate_owner_receipt({**good,key:value})
 def test_finance_integrity_checks_do_not_write_to_database(self):
  class Fake:
   def __init__(self,results):self.results=list(results);self.sql=[]
   def docker(self,*args,**kwargs):
    self.assertion=args
    assert args[:2]==("exec","detached_restore")
    assert "-e" in args and all(s not in " ".join(args).lower() for s in ["drop table","delete from","insert into","update finance_wallet","alter table"])
    self.sql.append(args[-1])
    return str(self.results.pop(0))
  obj=Fake([4,51316,147,0,0,0])
  result=m.check_finance_restored_database(obj,"detached_restore")
  self.assertEqual(result["compensated_credit_anomalies"],0)
  self.assertEqual(len(obj.sql),6)
  for answers in ([3,51316,147,0,0,0],[4,0,147,0,0,0],
                  [4,51316,147,1,0,0],[4,51316,147,0,1,0],
                  [4,51316,147,0,0,1]):
   with self.assertRaises(m.Blocked):
    m.check_finance_restored_database(Fake(answers),"detached_restore")
 def test_evidence_is_root_private_non_deploying_and_cannot_overwrite(self):
  with tempfile.TemporaryDirectory() as d:
   folder=Path(d)
   with patch.object(m,"OUT_DIR",folder),patch.object(m,"root_trusted",return_value=None):
    file=m.write_evidence("20261111T092019Z","a"*64,"42917752557",
                          69,45,{"restored_wallet_rows":51316},
                          dt.datetime(2026,11,11,9,35,tzinfo=dt.timezone.utc))
    p=folder/file
    data=json.loads(p.read_text())
    self.assertFalse(data["finance_release_authorized"])
    self.assertFalse(data["bounded_finance_release_executor_installed"])
    self.assertFalse(data["rollback_preimage_verified"])
    self.assertFalse(data["production_mutated"])
    self.assertEqual(p.stat().st_mode&0o777,0o600)
    with self.assertRaises(m.Blocked):
     m.write_evidence("20261111T092019Z","a"*64,"42917752557",
                      69,45,{},dt.datetime.now(dt.timezone.utc))
 def test_runtime_failure_codes_are_safe_and_do_not_log_sql(self):
  self.assertEqual(m.safe_failure_label(RuntimeError("pending_migrations_in_isolated_restore")),
                   "pending_migrations_in_isolated_restore")
  self.assertEqual(m.safe_failure_label(RuntimeError("command_failed:/usr/bin/docker:1")),
                   "command_failed")
  self.assertEqual(m.safe_failure_label(RuntimeError("SELECT * FROM users WHERE token=secret")),
                   "unclassified_runtime_error")
 def test_no_deploy_powers_are_defined(self):
  s=SCRIPT.read_text()
  self.assertNotIn("subprocess.Popen(['deploy'",s)
  self.assertNotIn("deploy-project",s)
  self.assertNotIn("systemctl start prhm-production-central-backup.service",s)
  self.assertIn("finance_release_authorized",s)
  self.assertIn("rollback_preimage_verified",s)
  self.assertIn("--network",s if "--network" in s else "restore-helper-is-sha-pinned --network")
if __name__=="__main__":unittest.main()
