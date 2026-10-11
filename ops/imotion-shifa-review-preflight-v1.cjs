'use strict';
// REVIEW ONLY: does not register actions, grant approval, access credentials, or deploy.
const IMOTION=Object.freeze({
 project:'imotion_admin_prod',repo:'prhmonline/Imo-back',
 root:'/home/imotion/domains/admin.i-motion.ir/public_html',
 head:'663627e38880db68c9fbe9488681773fbf605e2c',
 target:'9c94ad4dc7e770dd7b7534cf2f22717287a2245f',
 tree:'50ac66d36e30122911e5350ec11d2fa35a6770df',
 github:'05112307acd9bf3d754a2f25d47a1be6be64e1ad',
 paths:Object.freeze(("app/config/menus.php app/config/web.php app/controllers/AdminPackageUserController.php app/controllers/AdminReserveController.php "+
 "app/modules/finance/controllers/AdminController.php app/modules/finance/controllers/AdminDocumentController.php "+
 "app/modules/finance/models/FinanceDocument.php app/modules/finance/models/FinanceWallet.php "+
 "app/modules/finance/views/admin/_columns.php app/views/admin-reserve/_columns.php app/views/admin-reserve/_search.php "+
 "common/GlobalBootstrap.php common/models/ReserveSearch.php app/components/AuditLogClassifier.php "+
 "app/components/AuditTrailPayload.php app/components/AuditTrailWriter.php app/controllers/AdminAuditLogController.php "+
 "app/controllers/AdminChangeLogController.php app/controllers/SafeAdminPackageUserController.php "+
 "app/migrations/db/m261006_013000_create_audit_trail_table.php app/models/AdminAuditLogSearch.php "+
 "app/models/AdminChangeLogSearch.php app/models/SystemChangeLog.php app/views/site/admin-audit-log.php "+
 "app/views/site/admin-change-log-detail.php app/views/site/admin-change-log.php "+
 "tests/regression/PackageUserDeletionIntegrityTest.php").split(' '))
});
const SHIFA=Object.freeze({project:'shifa',repo:'prhmonline/shifa-platform',
 root:'/home/prhm/projects/shifa-platform',head:'98594d1ec7ed17cde73ad2023eab6bd3fc8e1447',
 github:'57380829f42d640562c022cd6eab36883252c8e8',
 path:'infra/docker/compose.infrastructure.yml'});
function end(project,failures){return Object.freeze({project,
 evidence_shape_valid:failures.length===0,failures:Object.freeze(failures),
 permission_granted:false,action_registered:false,approved:false,deployed:false,
 independent_security_review_required:true});}
function onlyKeys(e,allowed){return !!e&&typeof e==='object'&&!Array.isArray(e)&&
 Object.keys(e).every(x=>allowed.includes(x));}
function imotion(e){
 const errors=[];
 const allowed=['project','repo','root','head','target','tree','github','branch','paths','fileManifest'];
 if(!onlyKeys(e,allowed))return end(IMOTION.project,['INVALID_INPUT']);
 for(const k of ['project','repo','root','head','target','tree','github'])
  if(e[k]!==IMOTION[k])errors.push('BINDING_DRIFT_'+k);
 if(e.branch!=='main')errors.push('BRANCH_DRIFT');
 if(!Array.isArray(e.paths)||e.paths.length!==27||new Set(e.paths).size!==27||
  !IMOTION.paths.every(p=>e.paths.includes(p)))errors.push('DIRTY_PATH_SET_DRIFT');
 if(!Array.isArray(e.fileManifest)||e.fileManifest.length!==27||
  new Set(e.fileManifest.map(x=>x?.path)).size!==27||
  !IMOTION.paths.every(p=>e.fileManifest.some(x=>x?.path===p))||
  e.fileManifest.some(x=>!x||typeof x.sha256!=='string'||!/^[a-f0-9]{64}$/.test(x.sha256)||
   !Number.isInteger(x.mode)||x.mode<0||x.mode>0o777||x.symlink!==false||
   !['modified','untracked'].includes(x.status)))errors.push('PREIMAGE_SHA_MODE_INCOMPLETE');
 return end(IMOTION.project,errors);
}
function shifa(e){
 const errors=[];
 const allowed=['project','repo','root','head','github','branch','dirty','gitUser','readOnlyIdentity',
 'privateKeyDisclosed','runtimeTouched'];
 if(!onlyKeys(e,allowed))return end(SHIFA.project,['INVALID_INPUT']);
 for(const k of ['project','repo','root','head','github'])
  if(e[k]!==SHIFA[k])errors.push('BINDING_DRIFT_'+k);
 if(e.branch!=='main'||!Array.isArray(e.dirty)||e.dirty.length!==1||e.dirty[0]!==SHIFA.path)
  errors.push('GIT_WORKTREE_DRIFT');
 if(e.gitUser!=='prhm'||e.readOnlyIdentity!==true)errors.push('SCOPED_DEPLOY_IDENTITY_NOT_PROVEN');
 if(e.privateKeyDisclosed!==false||e.runtimeTouched!==false)errors.push('SECRET_OR_RUNTIME_SAFETY_NOT_PROVEN');
 return end(SHIFA.project,errors);
}
module.exports=Object.freeze({IMOTION,SHIFA,imotion,shifa});
if(require.main===module){process.stderr.write('Review-only, no installer or Production CLI.\n');process.exitCode=64;}
