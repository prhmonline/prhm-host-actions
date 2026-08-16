# ParsCoders SELinux v12.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the current ParsCoders runtime-v3 SELinux `203/EXEC` failure with exact-path persistent labels, add systemd-originated rollback-only validation, and prevent future runtime restores from recreating the same fault.

**Architecture:** Keep the existing canonical runtime paths under `/home/drtarjomeh/leadops/runtime-v3`. Harden the permanent restore helper so it assigns persistent `bin_t` mappings only to `collector` and `scorer` and validates them through a transient systemd unit before timer activation. Add a separate exact-state-bound Level-4 remediation action for the already-restored Production runtime, then register that action through a SHA-bound v12.2 bootstrap.

**Tech Stack:** Node.js (`prhm-node`), Node `node:test`, systemd/systemd-run, SELinux (`getenforce`, `semanage fcontext`, `restorecon`), PostgreSQL/psql, Host Actions v2, GitHub/DeployHQ rollout.

## Global Constraints

- SELinux must remain `Enforcing`; never call `setenforce`, never switch to Permissive, and never install an `audit2allow`-generated/custom policy module.
- Persistent labeling must use `semanage fcontext` plus `restorecon`; `chcon` is not an accepted persistent fix.
- Only `/home/drtarjomeh/leadops/runtime-v3/collector` and `/home/drtarjomeh/leadops/runtime-v3/scorer` may receive executable `bin_t` mappings.
- `.env`, `rules-v3-parscoders.sql`, `data/`, the runtime-v3 directory, `leadops/`, and `/home/drtarjomeh` must not be broadly relabeled executable.
- Preserve `P0_SHADOW_MODE=true`, `P0_DECISION_ENABLED=false`, `PROPOSAL_AUTO_SEND_ENABLED=false`, `AUTO_PROPOSAL_ENABLED=false`, P0 Live=false, P0 Decision=false, Proposal Send=false, Bid Send=false, Auto Send=false, External Send=false.
- Preserve the dedicated DB role `leadops_parscoders` and all existing least-privilege grants, including column-only `SELECT(idempotency_key)` on `automation.outbox_events`; do not grant full-table outbox SELECT or DELETE.
- `drtarjomeh` must not be added to the Docker group and Docker-based collector/scorer execution must not be reintroduced.
- Validation must use `PARSCODERS_VALIDATE_ONLY=1`, preserve rollback-only SQL semantics, and prove before/after safety counters are unchanged.
- The duplicate timer `Unit=` warning is out of scope for v12.2 because the timer has been proven to trigger the intended collector service.
- Production remediation is Level-4 critical, one-time, exact-request-bound, and requires a fresh `CONFIRM_LEVEL_4_CRITICAL`; confirmations from older requests never transfer.

---

### Task 1: Harden the permanent runtime restore helper

**Files:**
- Modify: `leadops-parscoders-runtime-v3-restore-v1.js:8-140`
- Create: `test-v12-2-parscoders-selinux-runtime-hardening.js`
- Modify after GREEN: `bootstrap-host-actions-v12-parscoders-runtime-v3-restore.js` embedded helper payload/hash only as required to keep the full-restore artifact from reinstalling the pre-v12.2 helper.

**Interfaces:**
- Consumes: existing `run(file,args,opt)`, `runLoose(file,args,opt)`, `systemctlValue(unit,prop)`, `safetyState()`, `assertSendSafety(state)`, `sameSafety(a,b)`, `COLLECTOR`, `SCORER`, `TIMER`.
- Produces: `selinuxMode(): string`, `selinuxType(file): string`, `inspectExactFcontext(file): {exists:boolean,type:string|null}`, `ensureExactExecFcontext(file): {path:string,created:boolean,before_type:string,after_type:string}`, `rollbackFcontext(change): void`, `systemdValidationRun(): {before:object,after:object,unit:string,avc_denials:number}`.

- [ ] **Step 1: Write the failing permanent-helper contract tests**

Create `test-v12-2-parscoders-selinux-runtime-hardening.js` with assertions that inspect the helper source and fail against the current implementation:

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const helper=fs.readFileSync('leadops-parscoders-runtime-v3-restore-v1.js','utf8');

test('v12.2 uses exact-path persistent SELinux mappings only',()=>{
  assert.match(helper,/\/usr\/sbin\/semanage/);
  assert.match(helper,/\/usr\/sbin\/restorecon/);
  assert.match(helper,/bin_t/);
  assert.match(helper,/COLLECTOR/);
  assert.match(helper,/SCORER/);
  assert.doesNotMatch(helper,/setenforce/);
  assert.doesNotMatch(helper,/\bchcon\b/);
  assert.doesNotMatch(helper,/audit2allow/);
  assert.doesNotMatch(helper,/runtime-v3\/\.\*/);
});

test('v12.2 validation is systemd-originated and rollback-only',()=>{
  assert.match(helper,/systemd-run/);
  assert.match(helper,/PARSCODERS_VALIDATE_ONLY/);
  assert.match(helper,/NoNewPrivileges/);
  assert.match(helper,/ProtectHome/);
  assert.match(helper,/ProtectSystem/);
  assert.doesNotMatch(helper,/run\('\/usr\/sbin\/runuser',\['-u','drtarjomeh','--',COLLECTOR\]/);
});

test('v12.2 records and rolls back mappings created by this action',()=>{
  assert.match(helper,/created/);
  assert.match(helper,/rollbackFcontext/);
  assert.match(helper,/restorecon/);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test test-v12-2-parscoders-selinux-runtime-hardening.js
```

Expected: FAIL because the current helper has no `semanage`/`restorecon` handling and still validates via `runuser`.

- [ ] **Step 3: Add exact SELinux inspection and mutation helpers**

In `leadops-parscoders-runtime-v3-restore-v1.js`, add fixed executable paths and helpers. Keep command arguments array-based; do not invoke a shell.

```js
const GETENFORCE='/usr/sbin/getenforce';
const SEMANAGE='/usr/sbin/semanage';
const RESTORECON='/usr/sbin/restorecon';
const LS='/usr/bin/ls';

function selinuxMode(){
  return String(run(GETENFORCE,[]).stdout||'').trim();
}

function selinuxType(file){
  const out=String(run(LS,['-Zd',file]).stdout||'').trim();
  const m=out.match(/\b[^:\s]+:object_r:([^:\s]+):[^\s]+\b/);
  if(!m)fail('selinux_context_parse_failed:'+file);
  return m[1];
}

function inspectExactFcontext(file){
  const r=runLoose(SEMANAGE,['fcontext','-C','-l']);
  if(r.status!==0)fail('semanage_fcontext_list_failed');
  const rows=String(r.stdout||'').split(/\r?\n/).filter(Boolean);
  const exact=rows.filter(line=>line.trim().startsWith(file+' '));
  if(exact.length>1)fail('fcontext_ambiguous:'+file);
  if(exact.length===0)return {exists:false,type:null};
  const cols=exact[0].trim().split(/\s+/);
  return {exists:true,type:cols[2]||null};
}

function ensureExactExecFcontext(file){
  const before_type=selinuxType(file);
  const existing=inspectExactFcontext(file);
  if(existing.exists&&existing.type!=='bin_t')fail('fcontext_conflict:'+file+':'+existing.type);
  let created=false;
  if(!existing.exists){run(SEMANAGE,['fcontext','-a','-t','bin_t',file]);created=true;}
  run(RESTORECON,['-v',file]);
  const after_type=selinuxType(file);
  if(after_type!=='bin_t')fail('selinux_type_not_bin_t:'+file+':'+after_type);
  return {path:file,created,before_type,after_type};
}

function rollbackFcontext(change){
  if(change&&change.created){
    run(SEMANAGE,['fcontext','-d',change.path]);
    run(RESTORECON,['-v',change.path]);
  }
}
```

Implementation requirement: if `selinuxMode()` is `Enforcing`, require `semanage` and `restorecon`; if it is neither `Enforcing` nor `Permissive` nor `Disabled`, fail closed. Never change the mode.

- [ ] **Step 4: Relabel after atomic runtime install and before validation**

Change `installRuntime()` so the two executable files are written first, then exact mappings are ensured, and the returned mapping state is retained for rollback:

```js
function installRuntime(c,password,b){
  const {uid,gid}=b.ids;
  fs.chownSync(RUNTIME,0,gid);fs.chmodSync(RUNTIME,0o750);
  atomic(COLLECTOR,c.collector,0o750,0,gid);
  atomic(SCORER,c.scorer,0o750,0,gid);
  atomic(RULES,c.rules,0o640,0,gid);
  atomic(ENV_FILE,envContent(password),0o640,0,gid);
  fs.mkdirSync(DATA_DIR,{mode:0o750});fs.chownSync(DATA_DIR,uid,gid);fs.chmodSync(DATA_DIR,0o750);
  const mode=selinuxMode();
  const fcontexts=mode==='Enforcing'||mode==='Permissive'
    ? [ensureExactExecFcontext(COLLECTOR),ensureExactExecFcontext(SCORER)]
    : [];
  return {selinux_mode:mode,fcontexts};
}
```

`main()` must store this return value before validation and pass it to rollback. `rollback()` must remove only mappings whose `created` flag is true, then `restorecon` those exact paths.

- [ ] **Step 5: Replace runuser validation with a transient systemd validation unit**

Add a unique transient unit with the same operational identity and minimum hardening needed to exercise the real execution path:

```js
function systemdValidationRun(){
  const before=safetyState();assertSendSafety(before);
  const unit='prhm-parscoders-runtime-v3-validate-'+Date.now();
  const started=new Date().toISOString();
  run('/usr/bin/systemd-run',[
    '--wait','--collect','--unit='+unit,
    '--property=Type=oneshot',
    '--property=User=drtarjomeh','--property=Group=drtarjomeh',
    '--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=PrivateDevices=true',
    '--property=ProtectHome=read-only','--property=ProtectSystem=full',
    '--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
    '--setenv=PARSCODERS_VALIDATE_ONLY=1',
    '--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    COLLECTOR
  ],{timeout:240000});
  const after=safetyState();assertSendSafety(after);sameSafety(before,after);
  const j=runLoose('/usr/bin/journalctl',['-k','--since',started,'--no-pager','-o','cat']);
  const avc=String(j.stdout||'').split(/\r?\n/).filter(x=>/avc:\s+denied/i.test(x)&&(/collector|scorer/.test(x)));
  if(avc.length)fail('selinux_avc_during_validation:'+avc.length);
  return {before,after,unit,avc_denials:0};
}
```

Replace the old `validationRun()` call with `systemdValidationRun()`. Keep `PARSCODERS_VALIDATE_ONLY=1` propagation to the scorer unchanged so SQL remains rollback-only.

- [ ] **Step 6: Extend helper result/preflight assertions**

Add fields proving SELinux and systemd validation state without leaking credentials:

```js
{
  selinux_mode,
  fcontext_scope:'exact_paths_only',
  collector_type:'bin_t',
  scorer_type:'bin_t',
  systemd_validation:true,
  validation_avc_denials:0,
  validation_mode:'rollback_only'
}
```

Preflight must remain non-mutating: it may inspect SELinux mode and existing rules but must not call `semanage -a/-d`, `restorecon`, `systemctl start/stop`, or `systemd-run`.

- [ ] **Step 7: Run targeted tests and syntax checks**

Run:

```bash
node --check leadops-parscoders-runtime-v3-restore-v1.js
node --test test-v12-parscoders-runtime-v3-restore.js test-v12-1-parscoders-outbox-conflict-privilege.js test-v12-2-parscoders-selinux-runtime-hardening.js
```

Expected: all PASS.

- [ ] **Step 8: Sync the full-restore bootstrap payload**

Update `bootstrap-host-actions-v12-parscoders-runtime-v3-restore.js` so `HELPER_B64` contains the new helper bytes and `HELPER_SHA` equals the new SHA-256. Do not change the action/operation name or widen the v12 policy scope.

Add a test assertion to `test-v12-2-parscoders-selinux-runtime-hardening.js` that decodes `HELPER_B64` and compares it byte-for-byte with `leadops-parscoders-runtime-v3-restore-v1.js`.

- [ ] **Step 9: Commit Task 1**

```bash
git add leadops-parscoders-runtime-v3-restore-v1.js bootstrap-host-actions-v12-parscoders-runtime-v3-restore.js test-v12-2-parscoders-selinux-runtime-hardening.js
git commit -m "fix: harden ParsCoders runtime SELinux execution"
```

---

### Task 2: Implement the exact-state-bound one-time SELinux remediation helper

**Files:**
- Create: `leadops-parscoders-selinux-exec-remediate-v1.js`
- Create: `test-v12-2-parscoders-selinux-remediation.js`

**Interfaces:**
- Consumes current Production v12.1 state: collector SHA `3d070b611850904e1be77ee037960f3a871baa9bd430eaab1adccaf8fe3a8760`, scorer SHA `7526b70a11447858a8af2a8c2a4c324570c7635bd4d7554377026e527f34ada0`, current installed restore-helper SHA `15e8274230ff33a0a1572430a5928bdd6a54210f687569d8e1009db947432d14`, canonical service users/groups and paths, enabled+active timer, SELinux Enforcing, current executable types `user_home_t` unless already in the exact intended remediated state.
- Produces result schema `prhm.host-action-result.v1` for action `leadops_parscoders_selinux_exec_remediate_v1`.

- [ ] **Step 1: Write the failing remediation contract tests**

Create `test-v12-2-parscoders-selinux-remediation.js`:

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const file='leadops-parscoders-selinux-exec-remediate-v1.js';

test('remediation helper exists and is exact-state-bound',()=>{
  assert.equal(fs.existsSync(file),true);
  const s=fs.readFileSync(file,'utf8');
  assert.match(s,/leadops_parscoders_selinux_exec_remediate_v1/);
  assert.match(s,/3d070b611850904e1be77ee037960f3a871baa9bd430eaab1adccaf8fe3a8760/);
  assert.match(s,/7526b70a11447858a8af2a8c2a4c324570c7635bd4d7554377026e527f34ada0/);
  assert.match(s,/15e8274230ff33a0a1572430a5928bdd6a54210f687569d8e1009db947432d14/);
});

test('remediation changes only exact fcontexts and uses systemd validation',()=>{
  const s=fs.readFileSync(file,'utf8');
  assert.match(s,/semanage/);assert.match(s,/restorecon/);assert.match(s,/systemd-run/);
  assert.match(s,/PARSCODERS_VALIDATE_ONLY/);
  assert.doesNotMatch(s,/setenforce|\bchcon\b|audit2allow/);
  assert.doesNotMatch(s,/runtime-v3\/\.\*/);
});

test('remediation restores timer state on success and rollback',()=>{
  const s=fs.readFileSync(file,'utf8');
  assert.match(s,/timer_before/);
  assert.match(s,/systemctl.*stop/s);
  assert.match(s,/restoreTimerState/);
  assert.match(s,/rollback/);
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
node --test test-v12-2-parscoders-selinux-remediation.js
```

Expected: FAIL because the remediation helper does not yet exist.

- [ ] **Step 3: Implement preflight and baseline binding**

Create `leadops-parscoders-selinux-exec-remediate-v1.js` with fixed constants and fail-closed baseline checks:

```js
const ACTION='leadops_parscoders_selinux_exec_remediate_v1';
const RUNTIME='/home/drtarjomeh/leadops/runtime-v3';
const COLLECTOR=RUNTIME+'/collector';
const SCORER=RUNTIME+'/scorer';
const TIMER='leadops-parscoders-collector.timer';
const COLLECTOR_SHA='3d070b611850904e1be77ee037960f3a871baa9bd430eaab1adccaf8fe3a8760';
const SCORER_SHA='7526b70a11447858a8af2a8c2a4c324570c7635bd4d7554377026e527f34ada0';
const INSTALLED_RESTORE_HELPER='/opt/prhm-agent-selfmaint-exec/actions/leadops-parscoders-runtime-v3-restore-v1.js';
const INSTALLED_RESTORE_HELPER_SHA='15e8274230ff33a0a1572430a5928bdd6a54210f687569d8e1009db947432d14';
```

`preflight()` must verify all of the following before mutation: root UID, SELinux=`Enforcing`, exact collector/scorer SHA, exact installed v12.1 helper SHA, `User=Group=drtarjomeh`, canonical ExecStart paths, timer enabled+active, no conflicting local fcontext rules, current type either `user_home_t` for both or exact already-remediated `bin_t` for both, P0/send-safe flags, existing least-privilege DB grants, and `drtarjomeh` not in Docker group.

Mixed label state (`collector=bin_t`, `scorer=user_home_t` or vice versa) must fail closed before mutation.

- [ ] **Step 4: Implement timer race isolation**

Record enabled/active state, stop but do not disable the timer during label mutation and validation:

```js
function captureTimerState(){
  return {enabled:unitFileState(TIMER),active:activeState(TIMER)};
}
function pauseTimer(timer_before){
  if(timer_before.active==='active')run('/usr/bin/systemctl',['stop',TIMER]);
}
function restoreTimerState(timer_before){
  if(timer_before.active==='active')run('/usr/bin/systemctl',['start',TIMER]);
  if(unitFileState(TIMER)!==timer_before.enabled)fail('timer_enabled_state_changed');
}
```

Never call `disable` for this remediation.

- [ ] **Step 5: Implement exact mappings, relabel, and systemd rollback-only validation**

Use the same exact helper functions and transient systemd validation contract as Task 1. Before mutation capture original full context strings and whether each local rule existed. Add only missing exact `bin_t` mappings. Run `restorecon` only on `COLLECTOR` and `SCORER`. Require effective type=`bin_t` for both.

Run the collector through transient systemd with `PARSCODERS_VALIDATE_ONLY=1`; require exit status 0, no relevant `avc: denied`, unchanged before/after safety counters, and no committed business mutation.

- [ ] **Step 6: Implement state-aware rollback**

On any failure after mutation:

```js
function rollback(changes,timer_before){
  const errors=[];
  for(const c of [...changes].reverse()){
    try{
      if(c.created)run('/usr/sbin/semanage',['fcontext','-d',c.path]);
      run('/usr/sbin/restorecon',['-v',c.path]);
    }catch(e){errors.push(String(e.message||e));}
  }
  try{restoreTimerState(timer_before);}catch(e){errors.push(String(e.message||e));}
  return {ok:errors.length===0,errors};
}
```

If a same-type exact rule already existed before the action, preserve it. Never delete a pre-existing mapping.

- [ ] **Step 7: Write the remediation result contract**

On success write `/var/lib/prhm-agent-selfmaint-exec/leadops-parscoders-selinux-exec-remediate-v1/latest.json` with at least:

```js
{
  ok:true,
  schema_version:'prhm.host-action-result.v1',
  action:ACTION,
  selinux_mode:'Enforcing',
  fcontext_scope:'exact_paths_only',
  collector_type_before:'user_home_t',
  collector_type_after:'bin_t',
  scorer_type_before:'user_home_t',
  scorer_type_after:'bin_t',
  systemd_validation:true,
  validation_mode:'rollback_only',
  validation_exit_status:0,
  validation_avc_denials:0,
  timer_state_restored:true,
  committed_database_mutation:false,
  business_mutation:false,
  external_send:false,
  p0_live:false,p0_decision:false,proposal_send:false,bid_send:false,auto_send:false
}
```

Do not include DB passwords, `.env` contents, approval tokens, or role credentials.

- [ ] **Step 8: Run remediation tests and syntax check**

```bash
node --check leadops-parscoders-selinux-exec-remediate-v1.js
node --test test-v12-2-parscoders-selinux-remediation.js
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add leadops-parscoders-selinux-exec-remediate-v1.js test-v12-2-parscoders-selinux-remediation.js
git commit -m "feat: add ParsCoders SELinux remediation action"
```

---

### Task 3: Register v12.2 in Host Actions v2 with a SHA-bound bootstrap

**Files:**
- Create: `bootstrap-host-actions-v12-2-parscoders-selinux-exec-remediate.js`
- Create: `test-v12-2-parscoders-selinux-bootstrap.js`
- Read/protect: `/opt/prhm-agent-selfmaint/server.js`, `/opt/prhm-agent-selfmaint-exec/server.js`, `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`, `/opt/prhm-company-control-plane/config/approval-policy.json`, existing protected helpers.

**Interfaces:**
- New action: `leadops_parscoders_selinux_exec_remediate_v1`.
- New operation: `host_action.leadops_parscoders_selinux_exec_remediate_v1`.
- New policy risk/level: `critical`, Level 4.
- Executor result validator consumes Task 2 result schema and rejects any non-false send/P0/business mutation field.

- [ ] **Step 1: Write failing bootstrap contract tests**

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const file='bootstrap-host-actions-v12-2-parscoders-selinux-exec-remediate.js';

test('v12.2 bootstrap registers a Level-4 critical remediation action',()=>{
  assert.equal(fs.existsSync(file),true);
  const s=fs.readFileSync(file,'utf8');
  assert.match(s,/leadops_parscoders_selinux_exec_remediate_v1/);
  assert.match(s,/host_action\.leadops_parscoders_selinux_exec_remediate_v1/);
  assert.match(s,/risk:'critical'/);
  assert.match(s,/level:4/);
});

test('v12.2 bootstrap embeds exact source bytes and protects current state',()=>{
  const s=fs.readFileSync(file,'utf8');
  assert.match(s,/15e8274230ff33a0a1572430a5928bdd6a54210f687569d8e1009db947432d14/);
  assert.match(s,/HELPER_B64/);
  assert.match(s,/REMEDIATION_B64/);
  assert.match(s,/sha_mismatch/);
});
```

- [ ] **Step 2: Run the bootstrap test and verify RED**

```bash
node --test test-v12-2-parscoders-selinux-bootstrap.js
```

Expected: FAIL because the v12.2 bootstrap does not yet exist.

- [ ] **Step 3: Implement exact current-state SHA bindings**

The bootstrap must bind to the currently installed control-plane state, including the known v12.1 restore helper SHA `15e8274230ff33a0a1572430a5928bdd6a54210f687569d8e1009db947432d14`. Before implementation, compute current repo bytes for the updated Task 1 helper and Task 2 remediation helper and embed both as Base64 with SHA-256 constants.

Keep the existing protected control-plane files SHA-bound using the current live values discovered by non-mutating preflight. If any protected SHA differs, fail before writing.

- [ ] **Step 4: Patch action enum, executor spec/dispatch, and policy**

Add exactly one new Host Action v2 enum entry and operation:

```js
leadops_parscoders_selinux_exec_remediate_v1: {
  operation:'host_action.leadops_parscoders_selinux_exec_remediate_v1',
  rollback:'host-action-v2:leadops-parscoders-selinux-exec-remediate-v1:fcontext-timer-restore'
}
```

Policy typed scope must be:

```js
{
  tool:'host_action_v2_apply',
  project:'control_plane',
  environment:'production',
  action:'leadops_parscoders_selinux_exec_remediate_v1',
  risk:'critical',
  operation:'host_action.leadops_parscoders_selinux_exec_remediate_v1',
  principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
}
```

Set the policy version to a new v12.2-specific value, for example `2026-08-16.3-leadops-parscoders-selinux-exec-remediate-v1`, and set executor version to `1.12.2-host-actions-v2-parscoders-selinux-exec-remediate`.

- [ ] **Step 5: Add server-side apply and strict result validation**

The executor must launch the remediation helper through a transient hardened root unit and accept only the exact safe result contract:

```js
if(result.ok!==true ||
   result.action!=='leadops_parscoders_selinux_exec_remediate_v1' ||
   result.selinux_mode!=='Enforcing' ||
   result.fcontext_scope!=='exact_paths_only' ||
   result.collector_type_after!=='bin_t' ||
   result.scorer_type_after!=='bin_t' ||
   result.systemd_validation!==true ||
   result.validation_mode!=='rollback_only' ||
   result.validation_exit_status!==0 ||
   result.validation_avc_denials!==0 ||
   result.timer_state_restored!==true ||
   result.committed_database_mutation!==false ||
   result.business_mutation!==false ||
   result.external_send!==false ||
   result.p0_live!==false || result.p0_decision!==false ||
   result.proposal_send!==false || result.bid_send!==false || result.auto_send!==false)
  throw new Error('leadops_parscoders_selinux_exec_remediate_result_invalid');
```

The outer action unit needs write access only to the existing action result/backup paths and the host paths required by the helper. Do not add Docker socket access.

- [ ] **Step 6: Implement non-mutating bootstrap preflight and rollback**

`--preflight-only` must syntax-check candidate files, verify embedded SHA values, run the Task 1 restore-helper preflight, run the Task 2 remediation `--preflight-only`, and report all mutation fields false.

On bootstrap install failure, atomically restore every protected control-plane file and the old restore helper; remove the newly installed remediation helper; restart only the services the bootstrap already owns; verify original SHAs after rollback.

- [ ] **Step 7: Run bootstrap tests and syntax checks**

```bash
node --check bootstrap-host-actions-v12-2-parscoders-selinux-exec-remediate.js
node --test test-v12-2-parscoders-selinux-bootstrap.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add bootstrap-host-actions-v12-2-parscoders-selinux-exec-remediate.js test-v12-2-parscoders-selinux-bootstrap.js
git commit -m "feat: register ParsCoders SELinux remediation v12.2"
```

---

### Task 4: Run the complete regression and security review gate

**Files:**
- Verify all files modified/created in Tasks 1-3.
- No Production files are written in this task.

**Interfaces:**
- Consumes all Task 1-3 commits.
- Produces exact test counts, changed-file list, source SHA-256 values, and a reviewed candidate commit suitable for Production preflight.

- [ ] **Step 1: Run syntax checks on every changed JavaScript file**

```bash
node --check leadops-parscoders-runtime-v3-restore-v1.js
node --check leadops-parscoders-selinux-exec-remediate-v1.js
node --check bootstrap-host-actions-v12-parscoders-runtime-v3-restore.js
node --check bootstrap-host-actions-v12-2-parscoders-selinux-exec-remediate.js
node --check test-v12-2-parscoders-selinux-runtime-hardening.js
node --check test-v12-2-parscoders-selinux-remediation.js
node --check test-v12-2-parscoders-selinux-bootstrap.js
```

Expected: all exit 0.

- [ ] **Step 2: Run targeted v12/v12.1/v12.2 tests**

```bash
node --test \
  test-v12-parscoders-runtime-v3-restore.js \
  test-v12-1-parscoders-outbox-conflict-privilege.js \
  test-v12-1-parscoders-remediation.js \
  test-v12-2-parscoders-selinux-runtime-hardening.js \
  test-v12-2-parscoders-selinux-remediation.js \
  test-v12-2-parscoders-selinux-bootstrap.js
```

Expected: all PASS.

- [ ] **Step 3: Run the full repository test suite**

```bash
node --test test-*.js
```

Expected: zero failures. Record the exact pass count rather than assuming the historical 43/43 count.

- [ ] **Step 4: Scan the candidate for prohibited broadening**

Run:

```bash
grep -RInE 'setenforce|\bchcon\b|audit2allow|docker exec|leadops_admin|runtime-v3/\.\*|/home/drtarjomeh.*bin_t' \
  leadops-parscoders-runtime-v3-restore-v1.js \
  leadops-parscoders-selinux-exec-remediate-v1.js \
  bootstrap-host-actions-v12-2-parscoders-selinux-exec-remediate.js
```

Expected: no prohibited implementation match. Any matches in explicit rejection/test strings must be manually classified and documented.

- [ ] **Step 5: Record candidate SHA-256 values**

```bash
sha256sum \
  leadops-parscoders-runtime-v3-restore-v1.js \
  leadops-parscoders-selinux-exec-remediate-v1.js \
  bootstrap-host-actions-v12-parscoders-runtime-v3-restore.js \
  bootstrap-host-actions-v12-2-parscoders-selinux-exec-remediate.js \
  test-v12-2-parscoders-selinux-runtime-hardening.js \
  test-v12-2-parscoders-selinux-remediation.js \
  test-v12-2-parscoders-selinux-bootstrap.js
```

Record the exact values in the implementation report/PR body.

- [ ] **Step 6: Review diff scope**

```bash
git diff --stat HEAD~3..HEAD
git diff --name-only HEAD~3..HEAD
```

Expected: only ParsCoders v12.2 helper/bootstrap/tests and the intended v12 full-restore payload sync.

- [ ] **Step 7: Create review PR and merge only after checks are clean**

The PR body must state: root cause `init_t -> user_home_t execute` AVC, exact-path `bin_t` strategy, systemd validation change, rollback design, zero send/live changes, and the exact test count. Merge only if the branch is clean/mergeable and review evidence matches the candidate commit.

---

### Task 5: Production preflight, bootstrap registration, and fresh Level-4 request

**Files:**
- Execute immutable merged bootstrap candidate.
- Production reads: control-plane SHA set, SELinux mode/contexts, systemd service/timer state, DB grants, P0/send flags.
- Production writes before Level-4 apply are limited to the separately reviewed control-plane bootstrap installation; the remediation itself remains pending until explicit confirmation.

**Interfaces:**
- Consumes merged v12.2 commit and exact candidate SHA values.
- Produces installed/registered Host Action v2 plus one fresh pending Level-4 request ID.

- [ ] **Step 1: Run merged bootstrap `--preflight-only` on Production**

Preflight acceptance requires:

```text
ok=true
preflight_only=true
production_mutation=false
database_mutation=false
business_mutation=false
p0_live=false
p0_decision=false
proposal_send=false
bid_send=false
auto_send=false
external_send=false
```

It must also prove current control-plane SHAs match the expected v12.1 baseline, SELinux=`Enforcing`, collector/scorer are still the expected v12.1 candidate hashes, and current labels are the known pre-remediation state.

- [ ] **Step 2: Install/register the v12.2 bootstrap from the immutable merged commit**

Verify exact script SHA before execution. On completion require health checks PASS and independently re-hash protected control-plane files. The bootstrap must not touch collector/scorer labels or timer state; it only installs updated action helpers and control-plane registration.

- [ ] **Step 3: Re-run remediation helper `--preflight-only` after registration**

Require the same non-mutating result and exact state binding. Do not create a Level-4 request if preflight fails or if labels have drifted/mixed.

- [ ] **Step 4: Create exactly one fresh Level-4 critical request**

Request fields must bind:

```text
action=leadops_parscoders_selinux_exec_remediate_v1
operation=host_action.leadops_parscoders_selinux_exec_remediate_v1
project_id=control_plane
environment=production
risk=critical
level=4
principal=mohammad
role=mcp-operator
tool=host_action_v2_apply
one_time_use=true
execution_authorized=false
status=pending
```

Immediately retire any temporary DeployHQ command slot back to `true`/no-op.

- [ ] **Step 5: Stop and request fresh confirmation**

Report the exact UUID and absolute expiration timestamp. Do not execute it until the user sends a fresh literal:

```text
CONFIRM_LEVEL_4_CRITICAL
```

If the request expires, do not reuse it and do not transfer the confirmation; create one new request and require another fresh confirmation.

---

### Task 6: Apply once and independently verify the repaired timer path

**Files:**
- No source changes expected.
- Production state changes are performed only by the approved remediation action.

**Interfaces:**
- Consumes one unexpired Level-4 request and fresh request-bound confirmation.
- Produces verified exact `bin_t` labels, successful systemd rollback-only validation, restored timer, and a successful subsequent real timer-triggered collector run.

- [ ] **Step 1: Apply only the confirmed request ID**

Use `host_action_v2_apply` with the exact UUID and `second_confirmation=CONFIRM_LEVEL_4_CRITICAL`. Never substitute a newer/older request ID.

- [ ] **Step 2: Poll the persisted result**

Require `status=succeeded`, approval consumed, and Task 2 result fields exactly matching the safe contract. If apply fails, verify rollback first and switch to read-only systematic debugging; do not patch manually.

- [ ] **Step 3: Independently verify SELinux scope**

Read-only checks must prove:

```text
getenforce -> Enforcing
collector type -> bin_t
scorer type -> bin_t
.env -> not bin_t
rules-v3-parscoders.sql -> not bin_t
data/ -> not bin_t
runtime-v3 directory -> not bin_t
```

`semanage fcontext -C -l` must show only the two approved exact-path ParsCoders mappings and no recursive Home/runtime executable rule.

- [ ] **Step 4: Independently verify service/timer and DB invariants**

Require collector/scorer `User=Group=drtarjomeh`, canonical ExecStart paths, timer enabled+active, intended schedule unchanged, `drtarjomeh` not in Docker group, DB role grants unchanged, full-table outbox SELECT=false, DELETE=false, and P0/send flags unchanged.

- [ ] **Step 5: Verify the first subsequent real timer run**

Wait for the already-scheduled next timer trigger and inspect service status/journal. Acceptance requires the collector passes the EXEC stage, exits successfully, produces no relevant SELinux AVC, and the timer remains active for its following interval.

This real run is allowed to perform the collector's normal discovery/evaluation database behavior, but proposal/bid/external send paths must remain disabled. Record any normal opportunity count changes separately from the rollback-only validation counters.

- [ ] **Step 6: Run verification-before-completion**

Before declaring the incident closed, invoke `superpowers:verification-before-completion` and re-check the evidence from Steps 2-5. Completion requires evidence, not inference.

- [ ] **Step 7: Close with an evidence report**

Report: applied request UUID, action/result status, exact effective labels, systemd validation result, timer real-run timestamp/result, DB privilege invariants, P0/send invariants, any normal discovery count delta, and rollback availability. Do not claim FINAL PASS if the real timer-triggered run has not yet been observed successfully.
