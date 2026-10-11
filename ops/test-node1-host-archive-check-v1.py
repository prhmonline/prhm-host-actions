#!/usr/bin/env python3
import importlib.util,io,os,pathlib,subprocess,tarfile,tempfile,unittest

ROOT=pathlib.Path(__file__).parent
SRC=ROOT/'node1-host-archive-check-v1.py'
RUN=ROOT/'prhm-node1-hostdata-backup-v1.sh'
spec=importlib.util.spec_from_file_location('host_archive',str(SRC))
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def entry(name,size=0,kind=tarfile.REGTYPE):
    x=tarfile.TarInfo(name);x.size=size;x.type=kind;return x

class Contract(unittest.TestCase):
    def test_complete_site_file_payload_success(self):
        result=mod.analyze([entry('home/imotion/domains/site/public_html/index.php',2000),
            entry('home/imotion/domains/site/public_html/wp-content/uploads/img.png',1500)],3400)
        self.assertTrue(result['ok'])
        self.assertEqual(result['site_regular_files'],2)
    def test_only_directories_cannot_green(self):
        r=mod.analyze([entry('home/imotion/domains',0,tarfile.DIRTYPE)],4294195982)
        self.assertFalse(r['ok'])
        self.assertEqual(r['archived_site_logical_bytes'],0)
    def test_missing_95pct_bytes_never_green(self):
        r=mod.analyze([entry('home/imotion/domains/site/wp/a.jpg',950)],100000)
        self.assertFalse(r['ok'])
    def test_path_traversal_rejected(self):
        with self.assertRaises(ValueError):
            mod.analyze([entry('home/../../etc/shadow',5000)],3000)
    def test_runtime_bash_contract_safeguards(self):
        r=subprocess.run(['/usr/bin/bash','-n',str(RUN)],timeout=6)
        self.assertEqual(r.returncode,0)
        r=subprocess.run(['/usr/bin/bash',str(RUN)],stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE,timeout=6)
        self.assertEqual(r.returncode,2)
        s=RUN.read_text()
        for needle in ['--single-transaction','--all-databases',
                       'home/imotion/domains','/usr/local/libexec/prhm-node1-host-archive-check-v1.py',
                       'sha256sum -c SHA256SUMS','vm_disk_backup_proven=false',
                       'offsite_independence_proven=false','trap cleanup EXIT']:
            self.assertIn(needle,s)
        for forbidden in ['virsh backup-begin','qemu-img convert','restic forget',
                          'restic prune','docker exec','systemctl restart','StrictHostKeyChecking=no']:
            self.assertNotIn(forbidden,s)
    def test_synthetic_real_zstd_archive_roundtrip(self):
        if not pathlib.Path('/usr/bin/zstd').is_file():
            self.skipTest('zstd binary not installed')
        with tempfile.TemporaryDirectory() as root:
            p=pathlib.Path(root)
            site=p/'home/imotion/domains/example/public_html'
            site.mkdir(parents=True)
            (site/'example.txt').write_bytes(b'hello-backup'*2048)
            archive=p/'fixture.tar'
            with tarfile.open(str(archive),'w') as t:
                t.add(str(p/'home'),arcname='home')
            zipped=p/'fixture.tar.zst'
            with zipped.open('wb') as out:
                c=subprocess.run(['/usr/bin/zstd','-q','-3','-c',str(archive)],
                                 stdout=out,timeout=15)
                self.assertEqual(c.returncode,0)
            size=(site/'example.txt').stat().st_size
            proof=mod.inspect(str(zipped),size)
            self.assertTrue(proof['ok'])
            self.assertEqual(proof['archived_site_logical_bytes'],size)

if __name__=='__main__':
    unittest.main()
