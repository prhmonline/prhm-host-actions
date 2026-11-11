#!/usr/bin/env python3
"""Synthetic, non-root, no-network tests for wallet schema diagnostic."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).resolve().parents[1]/"scripts/honartik-finance-wallet-schema-diagnostic-v1.py"
spec=importlib.util.spec_from_file_location("honartik_wallet_schema_diag",SOURCE)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class WalletSchemaDiagnosticTests(unittest.TestCase):
 def fixture(self,root):
  cfg={}
  for i in range(6):
   name="testconfig"+str(i)+".php"
   (root/name).write_text(str(i))
   cfg[name]=hashlib.sha256(str(i).encode()).hexdigest()
  files=[]
  for i in range(54):
   ver="m240101_%06d_fixture%d"%(i,i)
   name="app/migrations/"+ver+".php"
   f=root/name
   f.parent.mkdir(exist_ok=True,parents=True)
   text="fixture"+str(i)
   f.write_text(text)
   files.append({"version":ver,"path":name,"sha256":hashlib.sha256(text.encode()).hexdigest()})
  return {"schema":"prhm.honartik.finance.wallet-isolated-schema-review.v1",
          "live_base_sha":m.BASE,"finance_candidate_sha":m.TARGET,
          "required_migration_count":54,
          "config_sha256":cfg,"migration_files":files,
          "allow_any_historical_migration_replay":False,
          "allow_migration_ledger_stamping":False,
          "production_migration_authorized":False,
          "production_release_authorized":False}
 def test_exact_54_manifest_checks_paths_and_hashes(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d); p=self.fixture(root)
   self.assertEqual(m.validate_manifest(p,root),54)
   (root/p["migration_files"][2]["path"]).write_text("changed")
   with self.assertRaisesRegex(m.Blocked,"historical_migration_file_drift"):
    m.validate_manifest(p,root)
 def test_legacy_replay_and_production_release_never_allowed(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);p=self.fixture(root)
   for flag in ("allow_any_historical_migration_replay",
                "allow_migration_ledger_stamping",
                "production_migration_authorized",
                "production_release_authorized"):
    with self.subTest(flag=flag),self.assertRaisesRegex(m.Blocked,"manifest_must_forbid_mutation"):
     m.validate_manifest({**p,flag:True},root)
 def test_file_deletion_expansion_and_duplicate_version_fail(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);p=self.fixture(root)
   for arr in (p["migration_files"][:-1],
               p["migration_files"]+[p["migration_files"][0]],
               p["migration_files"][:-1]+[p["migration_files"][0]]):
    with self.assertRaises(m.Blocked):
     m.validate_manifest({**p,"migration_files":arr},root)
 def test_config_change_fails_closed(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);p=self.fixture(root)
   (root/"testconfig3.php").write_text("changed")
   with self.assertRaisesRegex(m.Blocked,"yii_discovery_config_drift"):
    m.validate_manifest(p,root)
 def test_schema_columns_and_first_indexes_have_exact_allowlist(self):
  cols=[t+"\t"+c for t,parts in m.EXPECTED_COLUMNS.items() for c in sorted(parts)]
  self.assertEqual(set(m.check_column_inventory(cols)),set(m.EXPECTED_COLUMNS))
  with self.assertRaisesRegex(m.Blocked,"wallet_required_schema_column_missing_"):
   m.check_column_inventory(cols[:-1])
  idx=[t+"\t1\t"+c for t,parts in m.INDEX_PREFIXES.items() for c in sorted(parts)]
  self.assertEqual(set(m.check_index_inventory(idx)),set(m.INDEX_PREFIXES))
  with self.assertRaisesRegex(m.Blocked,"wallet_required_index_missing"):
   m.check_index_inventory(idx[:-1])
 def test_sql_guard_rejects_writes_and_time_based_queries(self):
  class Dummy:
   def docker(self,*args,**kwargs):
    return "ok"
  for sql in ("DELETE FROM honartik_db.finance_wallet",
              "UPDATE honartik_db.iticket_checkout SET status='completed'",
              "SELECT 1 INTO OUTFILE '/tmp/data'",
              "SELECT SLEEP(3)",
              "SELECT id FROM user FOR UPDATE",
              "SELECT 1; DROP TABLE user"):
   with self.subTest(sql=sql),self.assertRaises(m.Blocked):
    m.query(Dummy(),"isolate",sql)
  self.assertEqual(m.query(Dummy(),"isolate","SELECT COUNT(*) FROM honartik_db.finance_wallet"),"ok")
 def test_source_can_issue_only_separate_no_go_diagnostic(self):
  src=SOURCE.read_text()
  for x in ('"release_authorized":False','"production_modified":False',
            '"snapshot_fresh_for_release":False',
            '"historical_yii_migration_replay_allowed":False',
            '"production_migrations_executed":False',
            'h.restore_isolated(ARCHIVE)',
            'module.IMAGE==IMAGE',
            'h.probe_restored_database=probe'):
   self.assertIn(x,src)
  for x in ('migrate/up','systemctl start','docker exec prhm-mariadb','GRANT ALL'):
   self.assertNotIn(x,src)
 def test_report_is_exclusive_and_private(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);root.chmod(0o700)
   evidence={"production_modified":False,"release_authorized":False}
   with patch.object(m,"REPORTS",root),patch.object(m,"trusted",return_value=None):
    name=m.write_private_report(evidence)
    file=root/name
    self.assertEqual(file.stat().st_mode&0o777,0o600)
    self.assertFalse(json.loads(file.read_text())["release_authorized"])
    with self.assertRaisesRegex(m.Blocked,"existing_report_must_not_overwrite"):
     m.write_private_report(evidence)

if __name__=="__main__":unittest.main()
