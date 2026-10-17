'use strict';
/**
 * DISK-BACKED ISOLATED FIXTURE ONLY.
 * No server paths, services, credentials or production mode.
 * Scratch directories are created exclusively by mkdtemp under os.tmpdir().
 * A real signed Level-4 adapter is NOT implemented here.
 */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ORDER,sha256}=require('./honartik-iticket-root-installer-transaction-engine-v1.cjs');
const PREFIX='prhm-iticket-tx-fixture-';
const NAME=/^prhm-iticket-tx-fixture-[A-Za-z0-9]{6,16}$/;
const ID=/^[a-z0-9][a-z0-9_-]{3,62}$/;
let seq=0;
function fail(x){throw Error('disk_fixture_'+x);}
function directorySync(dir){const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function ensureDir(d){fs.mkdirSync(d,{recursive:true,mode:0o700});directorySync(path.dirname(d));}
function checkedRoot(root){
  if(typeof root!=='string'||!NAME.test(path.basename(root))||root!==path.resolve(root))fail('root_invalid');
  const base=fs.realpathSync(os.tmpdir());
  if(path.dirname(root)!==base)fail('root_outside_scratch');
  const st=fs.lstatSync(root);
  if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(root)!==root||
     st.uid!==(process.getuid?.()??st.uid))fail('root_not_owned_regular');
  return root;
}
function regular(p){
  const st=fs.lstatSync(p);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)fail('unsafe_file');
  return st;
}
function fixedKey(k){if(!ORDER.includes(k))fail('key_invalid');return k;}
function fixedId(id){if(typeof id!=='string'||!ID.test(id))fail('id_invalid');return id;}
function atomic(file,bytes,metadata){
  if(!Buffer.isBuffer(bytes))fail('bytes_required');
  const dir=path.dirname(file),tmp=path.join(dir,'.'+path.basename(file)+'.'+process.pid+'-'+(++seq)+'.tmp');
  const m=metadata||{uid:process.getuid(),gid:process.getgid(),mode:0o600};
  let fd;
  try{
    fd=fs.openSync(tmp,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
    fs.fchmodSync(fd,m.mode);
    // Fixture owners are necessarily the invoking process, never root proxies.
    if(m.uid!==process.getuid()||m.gid!==process.getgid())fail('foreign_owner_not_supported');
    fs.writeFileSync(fd,bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);fd=undefined;
    fs.renameSync(tmp,file);
    directorySync(dir);
  }catch(e){
    if(fd!==undefined)fs.closeSync(fd);
    try{fs.unlinkSync(tmp);}catch{}
    throw e;
  }
}
function paths(root,id,key){
  const dir=path.join(root,'transactions',fixedId(id));
  return {dir,backup:path.join(dir,fixedKey(key)+'.bak'),
    backupMeta:path.join(dir,key+'.meta.json'),journal:path.join(dir,'journal.json')};
}
function existingSnapshot(file){
  const st=regular(file);
  return {bytes:fs.readFileSync(file),uid:st.uid,gid:st.gid,mode:st.mode&0o7777};
}
function createFixture(){
  const base=fs.realpathSync(os.tmpdir());
  const root=fs.mkdtempSync(path.join(base,PREFIX));
  checkedRoot(root);
  ensureDir(path.join(root,'owners'));
  ensureDir(path.join(root,'transactions'));
  ensureDir(path.join(root,'stages'));
  const candidates={},expected={};
  for(const key of ORDER){
    const before=Buffer.from('DISK_FIXTURE_ORIGINAL_'+key);
    candidates[key]=Buffer.from('DISK_FIXTURE_CANDIDATE_'+key);
    expected[key]=sha256(before);
    atomic(path.join(root,'owners',key+'.owner'),before,{uid:process.getuid(),gid:process.getgid(),mode:key==='exec'?0o750:0o640});
  }
  return {root,candidates,expected};
}
function openFixture(root,{failBefore,failAfter,failRollback,failHealth}={}){
  root=checkedRoot(root);
  let lockToken=null;
  const owner=k=>path.join(root,'owners',fixedKey(k)+'.owner');
  const journal=id=>path.join(root,'transactions',fixedId(id),'journal.json');
  const lockFile=path.join(root,'.tx.lock');
  function acquire(){
    for(let i=0;i<2;i++){
      try{
        const token=crypto.randomUUID();
        const fd=fs.openSync(lockFile,'wx',0o600);
        fs.writeFileSync(fd,JSON.stringify({pid:process.pid,token}));
        fs.fsyncSync(fd);fs.closeSync(fd);directorySync(root);
        lockToken=token;return;
      }catch(e){
        if(e.code!=='EEXIST')throw e;
        let pid;
        try{pid=JSON.parse(fs.readFileSync(lockFile,'utf8')).pid;}catch{fail('lock_invalid');}
        if(!Number.isInteger(pid)||pid<=0)fail('lock_invalid');
        let alive=true;
        try{process.kill(pid,0);}catch(error){
          if(error.code==='ESRCH')alive=false;
          else fail('lock_probe_failed');
        }
        if(alive)fail('lock_held');
        // Stale child lock; fixture only. A real production implementation
        // requires a kernel advisory lock (PID reuse makes this incomplete).
        fs.unlinkSync(lockFile);directorySync(root);
      }
    }
    fail('lock_retry_exhausted');
  }
  const adapter={
    async lock(){acquire();},
    async unlock(){
      if(!lockToken)return;
      const current=JSON.parse(fs.readFileSync(lockFile,'utf8'));
      if(current.token!==lockToken)fail('unlock_token_mismatch');
      fs.unlinkSync(lockFile);directorySync(root);lockToken=null;
    },
    async ensureNoUnresolved(id){
      for(const entry of fs.readdirSync(path.join(root,'transactions'))){
        const jp=journal(entry);
        if(!fs.existsSync(jp))continue;
        const j=JSON.parse(fs.readFileSync(jp,'utf8'));
        if(!['COMMITTED','ROLLED_BACK'].includes(j.state))fail('unresolved_transaction');
        if(entry===id)fail('transaction_id_reuse');
      }
    },
    async readOwner(key){return existingSnapshot(owner(key));},
    async writeBackupDurable(id,key,snap){
      const p=paths(root,id,key);
      ensureDir(p.dir);
      if(fs.existsSync(p.backup)||fs.existsSync(p.backupMeta))fail('backup_already_exists');
      atomic(p.backup,snap.bytes,snap);
      atomic(p.backupMeta,Buffer.from(JSON.stringify({uid:snap.uid,gid:snap.gid,mode:snap.mode,
        sha256:sha256(snap.bytes)})),{uid:process.getuid(),gid:process.getgid(),mode:0o600});
      return {durable:true};
    },
    async readBackup(id,key){
      const p=paths(root,id,key),meta=JSON.parse(fs.readFileSync(p.backupMeta,'utf8'));
      const bytes=fs.readFileSync(p.backup);
      if(sha256(bytes)!==meta.sha256)fail('backup_integrity');
      return {bytes,uid:meta.uid,gid:meta.gid,mode:meta.mode};
    },
    async writeJournalDurable(j){
      fixedId(j.id);
      const dir=path.join(root,'transactions',j.id);
      ensureDir(dir);
      atomic(path.join(dir,'journal.json'),Buffer.from(JSON.stringify(j,null,2)+'\n'),
        {uid:process.getuid(),gid:process.getgid(),mode:0o600});
      return {durable:true};
    },
    async loadJournal(id){return JSON.parse(fs.readFileSync(journal(id),'utf8'));},
    async stageCandidate(id,key,bytes,snap){
      const file=path.join(root,'stages',fixedId(id)+'-'+fixedKey(key)+'.stage');
      if(fs.existsSync(file))fail('stage_exists');
      atomic(file,bytes,snap);
      return file;
    },
    async commitCandidate(id,key,stage){
      key=fixedKey(key);fixedId(id);
      if(stage!==path.join(root,'stages',id+'-'+key+'.stage'))fail('stage_path_mismatch');
      if(failBefore===key)throw Error('fault_before_rename_'+key);
      regular(stage);regular(owner(key));
      fs.renameSync(stage,owner(key));
      directorySync(path.dirname(owner(key)));
      if(failAfter===key)throw Error('fault_after_rename_'+key);
    },
    async restoreBackup(id,key,snap){
      if(failRollback===key)throw Error('fault_rollback_'+key);
      // atomic itself uses stage+rename and fsyncs parent owner directory
      atomic(owner(key),snap.bytes,snap);
    },
    async verifyRuntime(phase){
      return {ok:!(failHealth===phase),fixture_only:true,real_service_health:false};
    },
    async cleanupStages(id){
      const prefix=fixedId(id)+'-';
      for(const name of fs.readdirSync(path.join(root,'stages'))){
        if(name.startsWith(prefix)&&name.endsWith('.stage')){
          const p=path.join(root,'stages',name);
          regular(p);fs.unlinkSync(p);
        }
      }
      directorySync(path.join(root,'stages'));
    }
  };
  return adapter;
}
function destroyFixture(root){checkedRoot(root);fs.rmSync(root,{recursive:true,force:false});}
module.exports=Object.freeze({createFixture,openFixture,destroyFixture});
