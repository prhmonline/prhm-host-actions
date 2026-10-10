#!/usr/bin/env python3
import importlib.util
import os
import pathlib
import subprocess
import unittest

SOURCE=pathlib.Path(__file__).parent/'node1-backup-coverage-audit-v1.py'
spec=importlib.util.spec_from_file_location('node1_backup_audit',str(SOURCE))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def fixture():
    return {
        'snapshot_age_hours':1,'checksum_pass':True,'complete':True,
        'database_inventory_count':6,'database_dump_valid':True,
        'site_content_bytes':4500000000,'archived_site_bytes':4500000000,
        'vm_backup_evidence':{'prhm-production':True,'imotion-directadmin':True},
        'independent_offsite_restore_proven':True
    }

class Contracts(unittest.TestCase):
    def test_true_fully_verified_fixture(self):
        r=module.assess(fixture())
        self.assertTrue(r['safe_to_call_fully_backed_up'])
        self.assertEqual(r['status'],'VERIFIED_FULL_NODE1')
    def test_stale_snapshot_never_green(self):
        f=fixture();f['snapshot_age_hours']=24.1
        self.assertIn('fresh_within_24h',module.assess(f)['missing'])
    def test_incomplete_home_archive_never_green(self):
        f=fixture();f['archived_site_bytes']=20000
        self.assertIn('site_content_present',module.assess(f)['missing'])
    def test_only_local_and_no_vm_or_remote_never_green(self):
        f=fixture();f['vm_backup_evidence']={'prhm-production':False,'imotion-directadmin':False}
        f['independent_offsite_restore_proven']=False
        r=module.assess(f)
        self.assertIn('vm_prhm_protected',r['missing'])
        self.assertIn('vm_imotion_protected',r['missing'])
        self.assertIn('independent_offsite_restore_proven',r['missing'])
    def test_missing_database_evidence_never_green(self):
        f=fixture();f['database_inventory_count']=5
        self.assertIn('database_inventory_complete',module.assess(f)['missing'])
    def test_binary_is_readonly_and_no_arbitrary_paths(self):
        c=SOURCE.read_text()
        for term in ['virsh backup-begin','useradd','systemctl restart','mysqldump --all-databases','shutil.rmtree','os.unlink','subprocess.Popen']:
            if term=='subprocess.Popen':self.assertIn(term,c)
            else:self.assertNotIn(term,c)
        r=subprocess.run(['/usr/bin/python3',str(SOURCE),'--apply'],
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=8)
        self.assertEqual(r.returncode,2)
        self.assertIn(b'READ_ONLY_ONLY',r.stderr)

if __name__=='__main__':
    unittest.main()
