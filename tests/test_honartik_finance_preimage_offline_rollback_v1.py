"""Synthetic preimage/rollback checks. Does NOT touch the user's host."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

P=Path(__file__).resolve().parents[1]/"scripts/honartik-finance-preimage-offline-rollback-v1.py"
spec=importlib.util.spec_from_file_location("finance_preimage",P)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Checks(unittest.TestCase):
 def test_exact_pins_and_release_safe_scope(self):
  self.assertEqual(m.BACK_SHA,"4ac602e874a128c3328f27f3dab473857512cdbf")
  self.assertEqual(m.FRONT_SHA,"1d8f9c30bda4ab8aab8d87b00e978890aa60efe9")
  self.assertEqual(m.CANDIDATE,"d1a64e640c9c2cf4788d55566c17728be5813941")
  self.assertEqual(len(m.HELPER_SHA),64)
  self.assertIn("/.next.building.*",m.FRONT_EXCLUDES)
  self.assertIn("/.next.rollback-*",m.FRONT_EXCLUDES)
  self.assertIn("/app/runtime/***",m.BACK_EXCLUDES)
  self.assertNotIn("/public/***",m.FRONT_EXCLUDES)
  self.assertNotIn("/web/uploads/***",m.BACK_EXCLUDES)
 def test_rsync_does_not_follow_symlinks_or_cross_filesystems(self):
  args=m.rsync_args(Path("/source"),Path("/dst"),m.FRONT_EXCLUDES)
  self.assertIn("--one-file-system",args)
  self.assertIn("--no-devices",args)
  self.assertIn("--no-specials",args)
  self.assertIn("-aH",args)
  self.assertNotIn("--copy-links",args)
  self.assertTrue(any(a.startswith("--exclude=") for a in args))
  self.assertNotIn("--delete",args)
  verify=m.rsync_args(Path("/source"),Path("/dst"),(),True)
  self.assertIn("-c",verify)
  self.assertIn("-n",verify)
  self.assertIn("--delete",verify)
 def test_archive_clone_is_byte_compared(self):
  with patch.object(m,"command",return_value="DIFFERENT_FILE"):
   with self.assertRaisesRegex(m.Blocked,"isolated_preimage_restore_mismatch"):
    m.verify_restored_tree(Path("/stage"),Path("/restore"))
  with patch.object(m,"command",return_value=""):
   m.verify_restored_tree(Path("/stage"),Path("/restore"))
 def test_changing_media_fails_closed(self):
  with patch.object(m,"command",return_value="changed-images"):
   with self.assertRaisesRegex(m.Blocked,"source_changed_during_preimage"):
    m.verify_against_live(Path("/source"),Path("/copy"),())
 def test_live_shas_and_wallet_flags_must_be_exact(self):
  with patch.object(m,"command",side_effect=[
    "prhm-production.prhm.ir",m.BACK_SHA,"",m.FRONT_SHA,""]):
   with patch.object(m,"FRONT",Path("/__never__")):
    with self.assertRaises(m.Blocked):
     m.live_fence()
 def test_source_has_no_production_mutators_or_release_flag(self):
  source=P.read_text()
  for x in ('"finance_release_authorized":False',
            '"runtime_cutover_rollback_tested":False',
            '"db_rollback_tested":False',
            '"production_modified":False',
            '"finance_release_executor_installed":False'):
   self.assertIn(x,source)
  self.assertIn('shutil.rmtree(stage)',source)
  self.assertIn('shutil.rmtree(restored)',source)
  self.assertIn('isolated_pinned_git_rollback_helper',source)
  self.assertNotIn("migrate/up",source)
  self.assertNotIn("systemctl restart",source)
  self.assertNotIn("git reset --hard",source)
  self.assertNotIn("ALTER TABLE",source)
  self.assertNotIn("enabled=1",source)
 def test_no_caller_specified_archive_paths(self):
  self.assertEqual(str(m.OUT),"/var/lib/prhm-honartik-finance-preimages")
  self.assertTrue(m.BACK.as_posix().startswith("/home/honartik/domains/"))
  self.assertTrue(m.FRONT.as_posix().startswith("/home/honartik/domains/"))
  self.assertFalse(hasattr(m,"restore_into_production"))
if __name__=="__main__": unittest.main()
