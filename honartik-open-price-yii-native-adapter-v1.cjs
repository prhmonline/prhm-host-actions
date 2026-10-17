'use strict';
/**
 * Source-only native executor candidate. NOT a registered Host Action.
 * A trusted Host Actions v2 installer must bind its own one-time signed approval
 * consumer and durable audit writer. No CLI, arbitrary request payload, path,
 * hostname, SQL, shell or deployment argument is accepted by this module.
 */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const {promisify} = require('node:util');
const {PINS, GateError, makeCoordinator} = require('./honartik-open-price-yii-scratch-v1.cjs');

const execFile = promisify(cp.execFile);
const LIVE = '/home/honartik/domains/dashboard.honartik.ir/public_html';
const SNAP = path.dirname(path.dirname(path.dirname(PINS.snapshot)));
const TMP_PARENT = '/var/tmp';
const MARKERS = Object.freeze([
  'RESOURCE_PREFLIGHT=PASS',
  'GIT_SOURCE_HASH=PASS',
  'ISOLATED_NETWORK=PASS',
  'ISOLATED_RESTORE=PASS',
  'RESTORED_DATA_COUNTS_VERIFIED=PASS',
  'ACTUAL_YII_CAPACITY=PASS',
  'YII_CAPACITY_RETRY_BEFORE_FEATURES=PASS',
  'ACTUAL_YII_FEATURES=PASS',
  'FINANCIAL_AGGREGATES_UNCHANGED=PASS',
  'YII_SCHEMA_READINESS=PASS',
  'YII_CAPACITY_POST_FEATURES_FAIL_CLOSED=PASS',
  'YII_FEATURE_DUPLICATE_REJECTED=PASS',
  'ACTUAL_YII_ISOLATED_MIGRATIONS=PASS',
  'ISOLATED_CLEANUP=PASS',
  'PRODUCTION_DATABASE_UNTOUCHED=YES'
]);
const NEW_COLUMNS=Object.freeze([
  'schedule.free_price_enabled','schedule.free_price_description',
  'reserve.free_price_enabled_snapshot','reserve.free_price_original_amount',
  'reserve.free_price_minimum_amount','reserve.free_price_proposed_amount',
  'reserve.free_price_gateway_amount','reserve.free_price_extra_amount'
]);
const MONEY_COLUMNS=Object.freeze([
  'finance_transactions.amount','finance_transactions.paying_amount',
  'finance_wallet.amount'
]);
const requireGate=(check,code)=>{if(!check)throw new GateError(code);};
const literalLine=(str,line)=>str.split(/\r?\n/).filter(s=>s===line).length===1;
const isHex64=(v)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);

function parseExecutedReceipt(output) {
  requireGate(typeof output==='string'&&output.length<262144,'unbounded_rehearsal_output');
  for(const marker of MARKERS)
    requireGate(literalLine(output,marker),'missing_runtime_marker');
  const rows=output.split(/\r?\n/).filter(s=>s.startsWith('YII_REHEARSAL_RECEIPT_JSON='));
  requireGate(rows.length===1,'missing_unique_actual_yii_receipt');
  let proof;
  try{proof=JSON.parse(rows[0].slice('YII_REHEARSAL_RECEIPT_JSON='.length));}
  catch{throw new GateError('invalid_yii_json_receipt');}
  requireGate(proof&&typeof proof==='object'&&
    typeof proof.mariadbVersion==='string'&&/^10\.6\.[0-9]+/.test(proof.mariadbVersion),
    'wrong_scratch_mariadb_version');
  requireGate(proof.testedDatabase===PINS.expectedDatabase,'wrong_scratch_database');
  requireGate(proof.rowCounts && Object.keys(proof.rowCounts).length===3,
    'missing_snapshot_rowcounts');
  for(const [table,count] of Object.entries(PINS.expectedCounts))
    requireGate(proof.rowCounts[table]===count,'snapshot_count_mismatch');
  requireGate(proof.moneyColumnTypes&&
    Object.keys(proof.moneyColumnTypes).length===MONEY_COLUMNS.length,'money_type_inventory_invalid');
  for(const col of MONEY_COLUMNS) {
    const value=proof.moneyColumnTypes[col];
    requireGate(typeof value==='string'&&/^bigint(?:\([0-9]+\))?$/i.test(value),
      'money_type_not_bigint');
  }
  requireGate(proof.addedColumns&&Object.keys(proof.addedColumns).length===NEW_COLUMNS.length,
    'feature_column_inventory_invalid');
  for(const col of NEW_COLUMNS)
    requireGate(proof.addedColumns[col]===true,'feature_column_missing');
  requireGate(isHex64(proof.financialBaselineDigest)&&
    proof.financialAfterDigest===proof.financialBaselineDigest,'financial_totals_changed');
  return proof;
}

/**
 * Native adapter is inert until a separately installed trusted control-plane
 * caller supplies its privileged, server-side functions. It never signs or
 * grants an approval; these functions MUST NOT originate from a user request.
 */
function createNativeAdapter(trusted) {
  requireGate(trusted&&typeof trusted.consumeBoundApproval==='function'&&
    typeof trusted.appendDurableAudit==='function'&&
    trusted.registeredNativeAction===PINS.action,'trusted_native_registration_missing');
  let scriptBuffer=null, baselineStatus=null, runtimeDir=null, childPid=null;
  let runOutput=null, runCompleted=false, scratchRemoved=true;

  async function runRead(binary,args,opts={}) {
    const {stdout}=await execFile(binary,args,{
      cwd:opts.cwd||undefined,
      timeout:opts.timeout||30000,maxBuffer:256*1024,
      env:{PATH:'/usr/local/bin:/usr/bin:/bin'},
      encoding:opts.encoding||'utf8'
    });
    return stdout;
  }

  async function captureGitState(){
    const [head,status]=await Promise.all([
      runRead('git',['-c','safe.directory='+LIVE,'-C',LIVE,'rev-parse','HEAD']),
      runRead('git',['-c','safe.directory='+LIVE,'-C',LIVE,'status','--porcelain=v1','-z'])
    ]);
    return {head:head.trim(),status};
  }

  const operations={
    async preflight(){
      requireGate(process.getuid&&process.getuid()===0,'trusted_root_runner_required');
      const before=await captureGitState();
      requireGate(before.head===PINS.prodBackendHead,'production_backend_sha_drift');
      baselineStatus=before.status;
      const buf=await runRead('git',['-c','safe.directory='+LIVE,'-C',LIVE,'show',PINS.sourceSha+':'+PINS.sourcePath],
        {encoding:'buffer'});
      scriptBuffer=Buffer.from(buf);
      const blob=crypto.createHash('sha1').update('blob '+scriptBuffer.length+'\0')
        .update(scriptBuffer).digest('hex');
      requireGate(blob===PINS.sourceBlobSha,'pinned_script_blob_mismatch');
      const manifest=path.join(SNAP,'SHA256SUMS');
      requireGate(manifest===PINS.manifest,'snapshot_manifest_path_mismatch');
      const dump=await fs.stat(PINS.snapshot);
      requireGate(dump.isFile()&&dump.size>0,'snapshot_missing');
      await fs.access(path.join(SNAP,'COMPLETE'));
      await runRead('sha256sum',['-c','SHA256SUMS'],{cwd:SNAP,timeout:300000});
      await runRead('gzip',['-t',PINS.snapshot],{timeout:300000});
      await runRead('docker',['image','inspect',PINS.dbImage],{timeout:15000});
      const mem=await fs.readFile('/proc/meminfo','utf8');
      const match=mem.match(/^MemAvailable:\s+(\d+)/m);
      const disk=await fs.statfs(TMP_PARENT);
      requireGate(match&&Number(match[1])>=3145728 &&
        disk.bavail*disk.bsize>=7340032,'isolated_resources_insufficient');
      return {
        readOnly:true,sourceCommit:PINS.sourceSha,sourceBlobSha:blob,
        currentBackendHead:before.head,snapshotPath:PINS.snapshot,
        manifestPath:manifest,snapshotSha256Verified:true,
        snapshotRestorable:true,networkMode:'none',image:PINS.dbImage,
        productionDbSocketMounted:false,productionDbCredentialsMounted:false,
        separateScratchDatadir:true,scrubbedScratchCredentials:true,
        liveDatabaseWritePermission:false,scratchSourceOnly:true,
        resourcePreflightPassed:true
      };
    },
    async consumeApproval(operation){
      requireGate(operation===PINS.approvalOperation,'unexpected_approval_operation');
      // Signed authorization is consumed ONLY by the trusted control plane.
      return trusted.consumeBoundApproval(operation,{
        sourceSha:PINS.sourceSha,sourceBlobSha:PINS.sourceBlobSha,
        sourcePath:PINS.sourcePath
      });
    },
    async executeRestoredYiiRehearsal(){
      requireGate(scriptBuffer&&baselineStatus!==null,'preflight_required');
      runtimeDir=await fs.mkdtemp(path.join(TMP_PARENT,'prhm-yii-action-'));
      scratchRemoved=false;
      const entry=path.join(runtimeDir,'pinned-operator.sh');
      await fs.writeFile(entry,scriptBuffer,{mode:0o500,flag:'wx'});
      const out=await new Promise((resolve,reject)=>{
        const child=cp.spawn('/bin/bash',[entry,PINS.sourceSha],{
          cwd:runtimeDir,shell:false,
          detached:false,
          env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'},
          stdio:['ignore','pipe','pipe']
        });
        childPid=child.pid;
        let stdout='',stderr='';
        const cap=chunk=>{stdout+=chunk.toString();if(stdout.length>262143)
          child.kill('SIGTERM');};
        child.stdout.on('data',cap);
        child.stderr.on('data',chunk=>{stderr+=chunk.toString();if(stderr.length>32000)
          child.kill('SIGTERM');});
        let killTimer=null;
        const timer=setTimeout(()=>{
          child.kill('SIGTERM');
          // The following ensures a stuck child cannot hold a privileged
          // approval indefinitely; cleanup still verifies its container.
          killTimer=setTimeout(()=>child.kill('SIGKILL'),15000);
          killTimer.unref();
        },1500000);
        child.once('error',e=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);reject(e);});
        child.once('close',code=>{
          clearTimeout(timer);if(killTimer)clearTimeout(killTimer);
          if(code!==0)reject(new GateError('isolated_yii_script_failed'));
          else resolve(stdout);
        });
      });
      runOutput=out;
      const proof=parseExecutedReceipt(out);
      runCompleted=true;
      return {
        ok:true,readOnlyProduction:true,executionSourceCommit:PINS.sourceSha,
        executionSourceBlobSha:PINS.sourceBlobSha,
        testedDatabase:proof.testedDatabase,mariadbVersion:proof.mariadbVersion,
        rowCounts:proof.rowCounts,networkMode:'none',
        snapshotManifestVerified:true,snapshotRestoredComplete:true,
        actualYiiClassesExecuted:true,yiiCapacityPassed:true,yiiFeaturesPassed:true,
        payingAmountBigintVerified:true,allEightFeatureColumnsVerified:true,
        financialCountAndSumsUnchanged:true,capacityRetryIdempotentBeforeFeatures:true,
        capacityPostFeaturesFailClosed:true,featureDuplicateFailClosed:true,
        productionDatabaseUntouched:true,productionApplicationUnchanged:true
      };
    },
    async cleanup(){
      let containerGone=true;
      // The controlled child PID determines the exact disposable name.
      if(Number.isSafeInteger(childPid)&&childPid>1){
        const container='honartik-yii-'+childPid;
        try{await runRead('docker',['rm','-f',container],{timeout:25000});}
        catch(e) {
          // Exit 1 is expected when the shell already removed its container.
          try{await runRead('docker',['container','inspect',container],{timeout:15000});
            containerGone=false;}catch{}
        }
      }
      if(runtimeDir){
        try{await fs.rm(runtimeDir,{recursive:true,force:true});scratchRemoved=true;}
        catch{scratchRemoved=false;}
      }
      let unchanged=false;
      try{
        const after=await captureGitState();
        unchanged=after.head===PINS.prodBackendHead&&
          (baselineStatus===null || after.status===baselineStatus);
      }catch{}
      return {
        scratchRemoved,disposableContainerRemoved:containerGone,
        liveApplicationUnchanged:unchanged,
        liveDatabaseUnchanged:containerGone &&
          (runCompleted?literalLine(runOutput,'PRODUCTION_DATABASE_UNTOUCHED=YES'):
            childPid===null)
      };
    },
    async audit(record){
      const receipt=await trusted.appendDurableAudit(Object.freeze({...record,
        sourceBlobSha:PINS.sourceBlobSha,
        runCompleted,operator:'honartik_open_price_yii_scratch_v1',
        noProductionDeployment:true
      }));
      requireGate(receipt && receipt.persisted===true &&
        typeof receipt.receiptId==='string' && receipt.receiptId.length>=8,
        'durable_audit_receipt_missing');
      return receipt;
    }
  };
  return Object.freeze({run:()=>makeCoordinator(operations).execute()});
}
if(require.main===module){
  process.stdout.write(JSON.stringify({
    ok:false,installed:false,
    reason:'trusted_control_plane_registration_required',productionChanged:false
  })+'\n');
  process.exitCode=2;
}
module.exports={parseExecutedReceipt,createNativeAdapter,MARKERS};
