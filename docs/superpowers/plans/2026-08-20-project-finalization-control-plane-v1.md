# Project Finalization Control Plane V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a central, fail-closed finalization control plane that verifies Git state, verifies deployment identity when required, synchronizes the Project Status Google Sheet with read-back verification, and returns `FINALIZE_PASS=YES` only when every required gate is proven.

**Architecture:** Keep the finalization rules and project registry canonical in `prhm-host-actions`, implement the finalizer as small CommonJS modules under `actions/project-change-finalize-v1/`, and expose it through the existing Host Actions request/apply/status model. V1 treats application commit creation and ordinary `git push` as caller responsibilities by default; the central finalizer verifies the expected remote SHA and only permits a future direct-push adapter for explicitly registered local worktrees. Sheet writes use a registry-bound adapter with optimistic read-before-write and post-write read-back verification.

**Tech Stack:** Node.js built-ins (`node:test`, `node:assert/strict`, `node:crypto`, `node:fs`, `node:path`, `node:child_process`, `node:https`), existing Host Actions bootstrap/approval model, Git/GitHub remote verification, Google Sheets API transport injected through a bounded adapter.

**Spec:** `docs/superpowers/specs/2026-08-20-project-finalization-control-plane-v1-design.md`

## Global Constraints

- The canonical global policy path is `policy/project-finalization-policy-v1.md`.
- The canonical registry path is `config/project-registry-v1.json`.
- The canonical registry schema path is `config/project-registry-v1.schema.json`.
- The canonical implementation unit is `actions/project-change-finalize-v1/`.
- The action name is exactly `project_change_finalize_v1`.
- Missing or unverifiable evidence must return `FINALIZE_PASS=NO`; never infer a production SHA from Git HEAD.
- The finalizer must never run `git add -A`, amend commits, force-push, rebase shared branches, delete refs, or choose files to commit.
- Secrets, credentials, tokens, env values, database dumps, backup archives, logs, runtime state, credential-bearing URLs, and secret scanner match contents must never be stored in the registry, Project Status sheet, or audit records.
- Caller-provided repository, branch, spreadsheet, tab, verifier, and adapter identities must exactly match registry bindings; no arbitrary shell commands or free-form paths are accepted.
- `change_id` is mandatory. Same `change_id` + same normalized payload is idempotent; same `change_id` + different normalized payload is rejected.
- A successful Git push or production deployment is not rolled back solely because Sheet synchronization later fails. Such state is persisted as `PARTIAL` and reconciled on retry.
- Sheet success requires post-write read-back equality, not only a successful write response.
- Staging and production SHA are tracked separately and may intentionally differ.
- Multi-repo projects must preserve unchanged repo SHAs rather than manufacture commits.
- V1 rollout is pilot-first. No broad enrollment until the controlled pilot proves Git verification, Sheet write/read-back, retry idempotency, and sanitized audit evidence.

---

## File Structure

Create these focused units:

```text
policy/
  project-finalization-policy-v1.md
config/
  project-registry-v1.json
  project-registry-v1.schema.json
actions/project-change-finalize-v1/
  index.js                  # orchestration only
  registry.js               # load/validate/resolve project bindings
  request.js                # normalize request + payload hash
  git-adapter.js            # remote SHA verification; optional registered push hook
  secret-guard.js           # path/pattern guard contract, sanitized result
  deployment-adapter.js     # registered verifier dispatcher
  sheet-adapter.js          # Project Status read/write/read-back
  state-store.js            # idempotency/audit records
  result.js                 # stable result contract
  errors.js                 # typed fail-closed errors
bootstrap-project-finalization-control-plane-v1.js

test-project-finalization-registry.js
test-project-finalization-request.js
test-project-finalization-git.js
test-project-finalization-sheet.js
test-project-finalization-deployment.js
test-project-finalization-state.js
test-project-finalization-orchestrator.js
test-bootstrap-project-finalization-control-plane-v1.js

docs/project-finalization/
  chatgpt-global-instructions.md
  codex-global-agents.md
  onboarding.md
```

Do not move or refactor unrelated historical bootstrap files. The repository currently uses root-level `test-*.js` files with `node:test`; continue that convention.

---

### Task 1: Canonical policy, registry schema, and seed registry

**Files:**
- Create: `policy/project-finalization-policy-v1.md`
- Create: `config/project-registry-v1.schema.json`
- Create: `config/project-registry-v1.json`
- Create: `test-project-finalization-registry.js`

**Interfaces:**
- Consumes: approved design spec.
- Produces: JSON registry document with top-level `version` and `projects`; JSON Schema used by `registry.js` in Task 2.

- [ ] **Step 1: Write the failing registry tests**

Create `test-project-finalization-registry.js` with `node:test` cases that load the schema/registry files as plain JSON and assert the minimum contract before any runtime module exists:

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const readJson=(p)=>JSON.parse(fs.readFileSync(path.join(__dirname,p),'utf8'));

test('registry has a versioned projects array and unique project keys',()=>{
  const registry=readJson('config/project-registry-v1.json');
  assert.equal(registry.version,'1');
  assert.ok(Array.isArray(registry.projects));
  const keys=registry.projects.map(p=>p.project_key);
  assert.equal(new Set(keys).size,keys.length);
});

test('registry contains no credential-like keys or credential-bearing URLs',()=>{
  const raw=fs.readFileSync(path.join(__dirname,'config/project-registry-v1.json'),'utf8');
  assert.doesNotMatch(raw,/password|api[_-]?key|authorization|private[_-]?key|access[_-]?token/i);
  assert.doesNotMatch(raw,/https?:\/\/[^\s"/]+:[^\s"@]+@/i);
});

test('schema requires immutable project identity and sheet binding',()=>{
  const schema=readJson('config/project-registry-v1.schema.json');
  const project=schema.$defs.project;
  for(const k of ['project_key','display_name','repositories','sheet','deployment','finalizer_ready']){
    assert.ok(project.required.includes(k),k);
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test test-project-finalization-registry.js
```

Expected: FAIL because policy/schema/registry files do not exist.

- [ ] **Step 3: Add the canonical policy document**

Create `policy/project-finalization-policy-v1.md` with the invariant, scope, fail-closed rules, forbidden Git behavior, secret rules, sheet read-back requirement, idempotency semantics, and the exact compact result keys from the spec. Keep it operational; do not duplicate the full design narrative.

- [ ] **Step 4: Add the JSON Schema**

Use Draft 2020-12 syntax. The root shape must be:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["version", "projects"],
  "properties": {
    "version": {"const": "1"},
    "projects": {
      "type": "array",
      "items": {"$ref": "#/$defs/project"}
    }
  },
  "additionalProperties": false
}
```

Define `$defs.project`, `$defs.repository`, `$defs.sheet`, and `$defs.deployment` so repositories require `role`, `repository`, `allowed_branches`, and `required_for_release`; Sheet requires `spreadsheet_id`, `tab`, and `adapter`; deployment requires `track_staging`, `track_production`, and `production_verifier` (`string|null`). Add optional `sheet.overview_name`, `sheet.field_labels`, `source_mapping_ref`, and `atomic_multi_repo` fields as data-only overrides.

Repository identity pattern: `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`.

Branch entries must be non-empty strings and may not contain whitespace, `..`, `~`, `^`, `:`, `?`, `*`, `[`, or backslash.

- [ ] **Step 5: Seed the registry conservatively**

Seed at least these known project keys with `finalizer_ready:false` unless all required bindings are already proven:

```json
{
  "version": "1",
  "projects": [
    {
      "project_key": "park-bazar",
      "display_name": "Park Bazar",
      "repositories": [{
        "role": "main",
        "repository": "prhmonline/park-bazar",
        "allowed_branches": ["main","baseline/live-import-20260819"],
        "required_for_release": true
      }],
      "sheet": {
        "spreadsheet_id": "1kA4fQ8398Rj_5zYiPXHfssL3R42dr_MSmVHtIdxnP4k",
        "tab": "Park Bazar",
        "adapter": "project_status_v1",
        "overview_name": "Park Bazar"
      },
      "deployment": {
        "track_staging": false,
        "track_production": true,
        "production_verifier": null
      },
      "atomic_multi_repo": false,
      "source_mapping_ref": "prhmonline/park-bazar:baseline/live-import-20260819/source-map.json",
      "finalizer_ready": false
    }
  ]
}
```

Add Gisheh and Solo Company with their exact repositories/tabs and `finalizer_ready:false`. Add further projects only when their repo/sheet identities are verified from current evidence; do not bulk-import guesses.

- [ ] **Step 6: Run the registry test**

Run:

```bash
node --test test-project-finalization-registry.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add policy/project-finalization-policy-v1.md config/project-registry-v1.json config/project-registry-v1.schema.json test-project-finalization-registry.js
git commit -m "feat: add finalization policy and project registry"
```

---

### Task 2: Registry loader and fail-closed resolver

**Files:**
- Create: `actions/project-change-finalize-v1/errors.js`
- Create: `actions/project-change-finalize-v1/registry.js`
- Modify: `test-project-finalization-registry.js`

**Interfaces:**
- Produces: `loadRegistry({registryPath}) -> {version,projects,hash}`
- Produces: `resolveProject(registry, projectKey) -> project`
- Produces: `resolveRepository(project, role, repository, branch) -> repositoryBinding`
- Produces typed errors with `.code` values such as `REGISTRY_INVALID`, `PROJECT_NOT_FOUND`, `REPOSITORY_NOT_REGISTERED`, `BRANCH_NOT_ALLOWED`.

- [ ] **Step 1: Add failing resolver tests**

Append tests using a temporary registry file:

```js
const os=require('node:os');
const {loadRegistry,resolveProject,resolveRepository}=require('./actions/project-change-finalize-v1/registry');

test('resolver rejects an unregistered branch',()=>{
  const r=loadRegistry({registryPath:path.join(__dirname,'config/project-registry-v1.json')});
  const p=resolveProject(r,'park-bazar');
  assert.throws(
    ()=>resolveRepository(p,'main','prhmonline/park-bazar','evil-branch'),
    e=>e.code==='BRANCH_NOT_ALLOWED'
  );
});
```

Also test duplicate project keys, duplicate repository roles, malformed repo identity, missing Sheet binding, and credential-like registry content.

- [ ] **Step 2: Run and verify failure**

```bash
node --test test-project-finalization-registry.js
```

Expected: FAIL because `registry.js` does not exist.

- [ ] **Step 3: Implement typed errors**

`errors.js`:

```js
class FinalizationError extends Error {
  constructor(code,message,details={}){
    super(message);
    this.name='FinalizationError';
    this.code=code;
    this.details=details;
  }
}
module.exports={FinalizationError};
```

- [ ] **Step 4: Implement registry validation without adding dependencies**

`registry.js` must parse JSON, calculate SHA-256 of the exact registry bytes, validate the required fields and patterns deterministically, reject duplicate keys/roles, reject unknown adapter identifiers, and reject `track_production:true` + `finalizer_ready:true` when `production_verifier:null`.

Use fixed allowlists:

```js
const SHEET_ADAPTERS=new Set(['project_status_v1']);
const DEPLOYMENT_VERIFIERS=new Set(['git_worktree_sha_v1','release_manifest_sha_v1']);
```

Do not silently ignore unknown properties that affect write targets.

- [ ] **Step 5: Run tests**

```bash
node --test test-project-finalization-registry.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add actions/project-change-finalize-v1/errors.js actions/project-change-finalize-v1/registry.js test-project-finalization-registry.js
git commit -m "feat: resolve registered finalization targets"
```

---

### Task 3: Request normalization and idempotency payload binding

**Files:**
- Create: `actions/project-change-finalize-v1/request.js`
- Create: `test-project-finalization-request.js`

**Interfaces:**
- Produces: `normalizeRequest(input, project) -> normalizedRequest`
- Produces: `hashNormalizedRequest(normalizedRequest) -> 64-char lowercase SHA-256`
- Normalized request contains sorted `expected_repos` by role so equivalent input order hashes identically.

- [ ] **Step 1: Write failing normalization tests**

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeRequest,hashNormalizedRequest}=require('./actions/project-change-finalize-v1/request');

const project={
  project_key:'demo',
  repositories:[
    {role:'front',repository:'org/front',allowed_branches:['main'],required_for_release:true},
    {role:'back',repository:'org/back',allowed_branches:['main'],required_for_release:true}
  ]
};

test('equivalent repo order produces identical request hash',()=>{
  const base={project_key:'demo',change_id:'chg-001',deploy_state:'not_deployed',summary:'sync',expected_repos:[
    {role:'front',repository:'org/front',branch:'main',expected_head_sha:'a'.repeat(40)},
    {role:'back',repository:'org/back',branch:'main',expected_head_sha:'b'.repeat(40)}
  ]};
  const a=normalizeRequest(base,project);
  const b=normalizeRequest({...base,expected_repos:[...base.expected_repos].reverse()},project);
  assert.equal(hashNormalizedRequest(a),hashNormalizedRequest(b));
});

test('summary rejects control characters and excessive length',()=>{
  assert.throws(()=>normalizeRequest({project_key:'demo',change_id:'chg-002',deploy_state:'not_deployed',summary:'x\nsecret',expected_repos:[]},project));
});
```

Add tests for invalid SHA, missing `change_id`, duplicate roles, repo/branch mismatch, unsupported deploy state, and unregistered repo.

- [ ] **Step 2: Run and verify failure**

```bash
node --test test-project-finalization-request.js
```

Expected: FAIL because `request.js` does not exist.

- [ ] **Step 3: Implement strict normalization**

Use SHA pattern `/^[0-9a-f]{40}$/` for Git SHA-1 refs in V1 and allow a future registry flag for SHA-256 repositories rather than accepting arbitrary text now. `change_id` must match `/^[A-Za-z0-9._:-]{8,128}$/`. `summary` must be 1-240 printable characters with CR/LF and NUL rejected.

- [ ] **Step 4: Run tests**

```bash
node --test test-project-finalization-request.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add actions/project-change-finalize-v1/request.js test-project-finalization-request.js
git commit -m "feat: bind finalization requests deterministically"
```

---

### Task 4: Git remote verification and commit-safety guard

**Files:**
- Create: `actions/project-change-finalize-v1/git-adapter.js`
- Create: `actions/project-change-finalize-v1/secret-guard.js`
- Create: `test-project-finalization-git.js`

**Interfaces:**
- Produces: `verifyRemoteHead(binding, expectedSha, transport) -> {remote_sha,verified}`
- Produces: `verifyCandidateSafety({changedPaths,scanResult}) -> {pass,reason}`
- V1 mandatory mode: remote verification.
- Optional direct push method may exist only as `pushRegisteredRef(...)` and must reject when the registry/source mapping does not explicitly enable a local canonical worktree. The initial seeded projects keep direct push disabled.

- [ ] **Step 1: Write failing tests with injected transports**

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const {verifyRemoteHead}=require('./actions/project-change-finalize-v1/git-adapter');
const {verifyCandidateSafety}=require('./actions/project-change-finalize-v1/secret-guard');

test('remote verification requires exact SHA equality',async()=>{
  const binding={repository:'org/repo',role:'main',allowed_branches:['main']};
  const transport={readHead:async()=> 'a'.repeat(40)};
  const out=await verifyRemoteHead(binding,'a'.repeat(40),transport,{branch:'main'});
  assert.deepEqual(out,{remote_sha:'a'.repeat(40),verified:true});
});

test('remote moved conflict fails closed',async()=>{
  const binding={repository:'org/repo',role:'main',allowed_branches:['main']};
  await assert.rejects(
    ()=>verifyRemoteHead(binding,'a'.repeat(40),{readHead:async()=> 'b'.repeat(40)},{branch:'main'}),
    e=>e.code==='REMOTE_SHA_MISMATCH'
  );
});

test('candidate guard blocks env and backup artifacts',()=>{
  assert.equal(verifyCandidateSafety({changedPaths:['.env'],scanResult:{pass:true}}).pass,false);
  assert.equal(verifyCandidateSafety({changedPaths:['backup/site.sql.gz'],scanResult:{pass:true}}).pass,false);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
node --test test-project-finalization-git.js
```

- [ ] **Step 3: Implement adapter with no shell interpolation**

The adapter receives a transport object. The production transport is built by the Host Actions runtime from registry-bound repository/branch values. The core module must not concatenate user input into shell strings.

`secret-guard.js` blocks exact/segment patterns including `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.sql`, `*.sql.gz`, `backup/`, `backups/`, `logs/`, `node_modules/`, cache directories, and scanner failure. Findings return only rule IDs and file paths, never matched secret text.

- [ ] **Step 4: Run tests**

```bash
node --test test-project-finalization-git.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add actions/project-change-finalize-v1/git-adapter.js actions/project-change-finalize-v1/secret-guard.js test-project-finalization-git.js
git commit -m "feat: verify remote git state safely"
```

---

### Task 5: Project Status Sheet adapter with optimistic concurrency and read-back

**Files:**
- Create: `actions/project-change-finalize-v1/sheet-adapter.js`
- Create: `test-project-finalization-sheet.js`

**Interfaces:**
- Produces: `buildDesiredSheetState({project,request,repoEvidence,deploymentEvidence,resultContext})`
- Produces: `syncProjectStatus({project,desired,transport,expectedPrior}) -> {updated,readback_verified,observed}`
- Transport methods: `readTab({spreadsheetId,tab})`, `writeCells({spreadsheetId,tab,updates})`, `readCells({spreadsheetId,tab,ranges})`.

- [ ] **Step 1: Write failing tests using an in-memory Sheet transport**

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const {syncProjectStatus}=require('./actions/project-change-finalize-v1/sheet-adapter');

function memoryTransport(initial){
  const state=structuredClone(initial);
  return {
    state,
    async readTab(){return structuredClone(state);},
    async writeCells({updates}){for(const u of updates) state[u.label]=u.value; return {ok:true};},
    async readCells({ranges}){return Object.fromEntries(ranges.map(r=>[r,state[r]]));}
  };
}

test('sheet sync verifies read-back equality',async()=>{
  const transport=memoryTransport({'وضعیت فعلی':'old','آخرین به‌روزرسانی':'old'});
  const project={sheet:{spreadsheet_id:'sheet-id',tab:'Demo',adapter:'project_status_v1',field_labels:{status:'وضعیت فعلی',updated_at:'آخرین به‌روزرسانی'}}};
  const desired={status:'active',updated_at:'2026-08-20'};
  const out=await syncProjectStatus({project,desired,transport,expectedPrior:{status:'old'}});
  assert.equal(out.updated,true);
  assert.equal(out.readback_verified,true);
});
```

Add tests for missing label, read-back mismatch, prior-state concurrency conflict, and write success followed by read failure.

- [ ] **Step 2: Run and verify failure**

```bash
node --test test-project-finalization-sheet.js
```

- [ ] **Step 3: Implement label-bound updates**

The `project_status_v1` adapter must locate fields by registered label names, never by free-form user-provided A1 ranges. Required normalized keys in V1: `status`, `git_status`, `updated_at`, `next_gate`; optional `production_status` and `risk` only when registry field labels exist.

For Overview updates, use `sheet.overview_name` to locate the project row by exact project name and update only registered Overview columns. If the Overview mapping is not registered, skip it as `N/A`; do not guess column positions.

- [ ] **Step 4: Require read-back verification**

A write response with mismatched or unreadable read-back returns `updated:true`, `readback_verified:false` and raises/returns `SHEET_READBACK_MISMATCH` at orchestration level.

- [ ] **Step 5: Run tests**

```bash
node --test test-project-finalization-sheet.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add actions/project-change-finalize-v1/sheet-adapter.js test-project-finalization-sheet.js
git commit -m "feat: synchronize project status with readback"
```

---

### Task 6: Deployment verifier dispatcher

**Files:**
- Create: `actions/project-change-finalize-v1/deployment-adapter.js`
- Create: `test-project-finalization-deployment.js`

**Interfaces:**
- Produces: `verifyDeployment({project,request,repoEvidence,verifiers}) -> {state,verified,repo_shas}`
- Registered verifier signatures: `async verifier({project,request,repoEvidence})`.

- [ ] **Step 1: Write failing tests**

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const {verifyDeployment}=require('./actions/project-change-finalize-v1/deployment-adapter');

test('not_deployed returns N/A without calling a verifier',async()=>{
  const out=await verifyDeployment({project:{deployment:{}},request:{deploy_state:'not_deployed'},repoEvidence:[],verifiers:{}});
  assert.deepEqual(out,{state:'not_deployed',verified:null,repo_shas:{}});
});

test('production tracking fails when verifier is unavailable',async()=>{
  const project={deployment:{track_production:true,production_verifier:null}};
  await assert.rejects(
    ()=>verifyDeployment({project,request:{deploy_state:'production'},repoEvidence:[],verifiers:{}}),
    e=>e.code==='PRODUCTION_VERIFIER_UNAVAILABLE'
  );
});
```

Add exact-SHA mismatch test for a fake verifier.

- [ ] **Step 2: Run and verify failure**

```bash
node --test test-project-finalization-deployment.js
```

- [ ] **Step 3: Implement dispatcher**

Only registry-selected verifier IDs may run. For production, every changed repo role that is production-tracked must map to an observed SHA equal to expected remote SHA. HTTP health-only evidence never satisfies the contract.

- [ ] **Step 4: Run tests and commit**

```bash
node --test test-project-finalization-deployment.js
git add actions/project-change-finalize-v1/deployment-adapter.js test-project-finalization-deployment.js
git commit -m "feat: verify deployed commit identity"
```

---

### Task 7: Idempotency state store and sanitized audit trail

**Files:**
- Create: `actions/project-change-finalize-v1/state-store.js`
- Create: `test-project-finalization-state.js`

**Interfaces:**
- Produces: `createFileStateStore({rootDir})`
- Methods: `get(changeId)`, `begin({changeId,payloadHash,projectKey,registryHash})`, `checkpoint(changeId,patch)`, `finish(changeId,result)`.

- [ ] **Step 1: Write failing filesystem-store tests**

Use `fs.mkdtempSync(path.join(os.tmpdir(),'finalizer-state-'))` and verify:

- same `change_id` + same payload returns existing record;
- same `change_id` + different payload throws `IDEMPOTENCY_CONFLICT`;
- checkpoint writes atomically via temporary file + rename;
- serialized state does not contain keys matching `/token|password|authorization|private_key/i`.

- [ ] **Step 2: Run and verify failure**

```bash
node --test test-project-finalization-state.js
```

- [ ] **Step 3: Implement the store**

Use file names derived from SHA-256 of `change_id`, not raw user input. Persist mode `0600` when supported. Store only sanitized fields defined by the spec. Use `fs.writeFileSync(tmp,{mode:0o600})`, `fs.fsyncSync`, then `fs.renameSync` for atomic replacement.

- [ ] **Step 4: Run tests and commit**

```bash
node --test test-project-finalization-state.js
git add actions/project-change-finalize-v1/state-store.js test-project-finalization-state.js
git commit -m "feat: persist idempotent finalization state"
```

---

### Task 8: Stable result contract and finalizer orchestrator

**Files:**
- Create: `actions/project-change-finalize-v1/result.js`
- Create: `actions/project-change-finalize-v1/index.js`
- Create: `test-project-finalization-orchestrator.js`

**Interfaces:**
- Produces: `finalizeChange(input,deps) -> Promise<FinalizationResult>`
- `deps` contains `registryPath`, `gitTransport`, `secretScanner`, `sheetTransport`, `deploymentVerifiers`, `stateStore`, and `clock`.

- [ ] **Step 1: Write failing happy-path test**

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const {finalizeChange}=require('./actions/project-change-finalize-v1');

test('single repo non-deployed change completes only after remote and sheet readback pass',async()=>{
  const result=await finalizeChange({
    project_key:'demo',
    change_id:'change-0001',
    deploy_state:'not_deployed',
    summary:'verified change',
    test_pass:true,
    expected_repos:[{role:'main',repository:'org/repo',branch:'main',expected_head_sha:'a'.repeat(40)}]
  },makeHappyDeps());
  assert.equal(result.FINALIZE_PASS,'YES');
  assert.equal(result.CHANGE_STATUS,'COMPLETED');
  assert.equal(result.REMOTE_SHA_VERIFIED,'YES');
  assert.equal(result.SHEET_READBACK_VERIFIED,'YES');
});
```

`makeHappyDeps()` lives in the test file and supplies a temporary registry plus in-memory transports; do not add a production dependency for testing.

- [ ] **Step 2: Add partial/failure tests before implementation**

Required cases:

1. tests not PASS -> `BLOCKED`, no Sheet write;
2. secret guard fails -> `BLOCKED`, no Sheet write;
3. remote SHA mismatch -> `BLOCKED`;
4. Git verified + Sheet write fails -> `PARTIAL`, `CHANGE_APPLIED=YES`, `FINALIZE_PASS=NO`;
5. Sheet write succeeds + read-back mismatches -> `PARTIAL`;
6. production verifier unavailable -> `BLOCKED` before Sheet advancement to completed state;
7. multi-repo backend-only change preserves observed frontend SHA;
8. retry same `change_id` after Sheet failure reconciles without duplicate history;
9. same `change_id` different payload -> `BLOCKED` with `IDEMPOTENCY_CONFLICT`.

- [ ] **Step 3: Run and verify failure**

```bash
node --test test-project-finalization-orchestrator.js
```

- [ ] **Step 4: Implement `result.js`**

Build only these compact keys:

```js
const ORDER=[
  'PROJECT','CHANGE_ID','CHANGE_STATUS','TEST_PASS','GIT_SYNC',
  'REMOTE_SHA_VERIFIED','DEPLOY_STATE','STAGING_SHA_VERIFIED',
  'PRODUCTION_SHA_VERIFIED','SHEET_UPDATED','SHEET_READBACK_VERIFIED',
  'FINALIZE_PASS','BLOCKER','NEXT_GATE'
];
```

Structured per-repo evidence is returned separately as `repositories` and never flattened into arbitrary strings.

- [ ] **Step 5: Implement the orchestration order**

`index.js` executes exactly:

1. load registry and resolve project;
2. normalize/hash request;
3. open/reconcile idempotency record;
4. require upstream `test_pass===true` for mutating finalization;
5. secret/path guard evidence;
6. verify remote SHA for every changed repo and observe unchanged required repos;
7. verify staging/production identity when requested;
8. build desired Sheet state;
9. perform optimistic Sheet sync;
10. read back target fields;
11. finish sanitized state record;
12. return stable result.

A failure after remote verification but before/at Sheet convergence must be `PARTIAL`, not `COMPLETED`.

- [ ] **Step 6: Run tests**

```bash
node --test test-project-finalization-orchestrator.js
```

Expected: PASS.

- [ ] **Step 7: Run all V1 unit tests**

```bash
node --test \
  test-project-finalization-registry.js \
  test-project-finalization-request.js \
  test-project-finalization-git.js \
  test-project-finalization-sheet.js \
  test-project-finalization-deployment.js \
  test-project-finalization-state.js \
  test-project-finalization-orchestrator.js
```

Expected: all PASS.

- [ ] **Step 8: Commit Task 8**

```bash
git add actions/project-change-finalize-v1/result.js actions/project-change-finalize-v1/index.js test-project-finalization-orchestrator.js
git commit -m "feat: orchestrate project finalization gates"
```

---

### Task 9: Host Actions bootstrap, schema registration, and approval binding

**Files:**
- Create: `bootstrap-project-finalization-control-plane-v1.js`
- Create: `test-bootstrap-project-finalization-control-plane-v1.js`
- Runtime targets patched by bootstrap only after fingerprinted preflight:
  - `/opt/prhm-agent-selfmaint/server.js`
  - `/opt/prhm-agent-selfmaint-exec/server.js`
  - `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`
  - `/opt/prhm-company-control-plane/config/approval-policy.json`

**Interfaces:**
- Adds exact enum/action: `project_change_finalize_v1`.
- Request schema accepts structured typed fields from Task 3; no arbitrary command/path arguments.
- Existing request/apply/status and replay protection remain authoritative.

- [ ] **Step 1: Write failing bootstrap patch tests**

Follow the established repository pattern used by `test-host-actions-v6-solo-company-selftest.js`: load the bootstrap source into a temporary module after replacing terminal `main();` with explicit exports.

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');

function load(){
  const src=fs.readFileSync(path.join(__dirname,'bootstrap-project-finalization-control-plane-v1.js'),'utf8')
    .replace(/\nmain\(\);\s*$/,'\nmodule.exports={patchBase,patchExecutor,patchPlugin,patchPolicy};\n');
  const p=path.join(os.tmpdir(),'project-finalizer-'+process.pid+'-'+Date.now()+'.js');
  fs.writeFileSync(p,src); const m=require(p); fs.unlinkSync(p); return m;
}

test('plugin patch exposes only the fixed finalizer action',()=>{
  const {patchPlugin}=load();
  const src="const HostActionV2=z.enum(['solo_company_selftest_v1']);";
  const out=patchPlugin(src);
  assert.match(out,/project_change_finalize_v1/);
  assert.match(out,/solo_company_selftest_v1/);
});
```

Add tests that policy patch binds the action to the existing approval model, preserves existing typed scopes, and does not introduce arbitrary `command`, `path`, or `sheet_id` free-form fields outside registry-bound identifiers.

- [ ] **Step 2: Run and verify failure**

```bash
node --test test-bootstrap-project-finalization-control-plane-v1.js
```

- [ ] **Step 3: Implement fingerprinted preflight**

The bootstrap must calculate SHA-256 for every live target file and refuse mutation unless the baseline set was explicitly captured/reviewed for this release. Do not bundle an old full runtime and overwrite newer live files. Reuse the additive patch style from recent Host Actions bootstraps.

- [ ] **Step 4: Implement installation payload**

Install the canonical action modules, policy, registry/schema, and runtime state directory under a dedicated root such as `/opt/prhm-project-finalizer/`, while keeping repository copies authoritative. State directory permissions must prevent world-readable audit data.

- [ ] **Step 5: Register exact schema and approval mapping**

The public MCP tool may expose the typed finalizer only after:

- Base action registry knows `project_change_finalize_v1`;
- executor validates the structured payload;
- MCP enum/schema exposes the action;
- approval policy contains the reviewed risk classification;
- installed module hashes match expected repo artifacts.

Do not change unrelated action levels/scopes.

- [ ] **Step 6: Run bootstrap tests and existing regression tests**

```bash
node --test test-bootstrap-project-finalization-control-plane-v1.js
node --test test-host-actions-v6-solo-company-selftest.js test-host-actions-v9-company-os-dashboard.js test-v8-1-approval-policy-reload.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 9**

```bash
git add bootstrap-project-finalization-control-plane-v1.js test-bootstrap-project-finalization-control-plane-v1.js
git commit -m "feat: bootstrap project finalization host action"
```

---

### Task 10: Global ChatGPT/Codex instruction artifacts and onboarding procedure

**Files:**
- Create: `docs/project-finalization/chatgpt-global-instructions.md`
- Create: `docs/project-finalization/codex-global-agents.md`
- Create: `docs/project-finalization/onboarding.md`

**Interfaces:**
- These are concise client policies pointing to the central finalizer; they do not duplicate registry data.

- [ ] **Step 1: Add ChatGPT global instruction text**

The file must state, in compact form:

```text
For every mutating technical task, identify the registered project key and do not report completion until project_change_finalize_v1 returns FINALIZE_PASS=YES. The application workflow must create/review/test its commit and synchronize it to the registered remote before finalization unless that project's registered adapter explicitly performs the push. If the finalizer is unavailable or any Git/Sheet/deployment evidence cannot be verified, report FINALIZE_PASS=NO and the exact blocker. Never infer project mappings from memory when the registry is available.
```

- [ ] **Step 2: Add Codex global `AGENTS.md` template**

The artifact must instruct Codex to preserve repo-local build/test instructions while enforcing the global finalization invariant. It must explicitly forbid treating a local commit as complete before remote verification and Sheet sync.

- [ ] **Step 3: Add onboarding procedure**

`onboarding.md` must require, in order:

1. verified repository identity;
2. Source Mapping for server-backed projects;
3. branch policy registration;
4. Sheet tab/label mapping validation;
5. deployment verifier capability declaration;
6. registry validator PASS;
7. dry-run finalizer against unchanged state;
8. `finalizer_ready:true` only after all required adapters prove read/write/read-back behavior.

- [ ] **Step 4: Commit Task 10**

```bash
git add docs/project-finalization/chatgpt-global-instructions.md docs/project-finalization/codex-global-agents.md docs/project-finalization/onboarding.md
git commit -m "docs: define global finalization client policy"
```

---

### Task 11: Controlled pilot, reconciliation tests, and rollout gate

**Files:**
- Modify: `config/project-registry-v1.json`
- Modify: `test-project-finalization-orchestrator.js`
- Create: `docs/project-finalization/pilot-park-bazar.md`

**Interfaces:**
- Pilot project: `park-bazar` only, initially `deploy_state=not_deployed`.
- Pilot must not claim production verification.

- [ ] **Step 1: Finish Park Bazar registry bindings from verified evidence**

Before enabling the pilot, confirm the exact Sheet field labels and the remote repository/branch. Keep `production_verifier:null`; this pilot is Git + Sheet synchronization only.

Set `finalizer_ready:true` only after the dry-run reads the current remote and Sheet state without mutation and every required mapping resolves exactly.

- [ ] **Step 2: Add a dry-run mode test**

The dry-run request must execute project resolution, request normalization, Git remote observation, desired Sheet-state calculation, and concurrency checks without calling `writeCells`. Its result is `FINALIZE_PASS=NO` with `NEXT_GATE=APPLY_FINALIZATION` unless the current Sheet already equals desired state, in which case it may report `DRY_RUN_CONVERGED=YES` in structured evidence but never fabricate an apply result.

- [ ] **Step 3: Run the complete local test suite relevant to the new control plane**

```bash
node --test \
  test-project-finalization-registry.js \
  test-project-finalization-request.js \
  test-project-finalization-git.js \
  test-project-finalization-sheet.js \
  test-project-finalization-deployment.js \
  test-project-finalization-state.js \
  test-project-finalization-orchestrator.js \
  test-bootstrap-project-finalization-control-plane-v1.js
```

Expected: all PASS.

- [ ] **Step 4: Run static secret and syntax checks**

```bash
node --check actions/project-change-finalize-v1/index.js
node --check bootstrap-project-finalization-control-plane-v1.js
! grep -RniE '(BEGIN (RSA |OPENSSH )?PRIVATE KEY|Authorization:[[:space:]]*Bearer|password[[:space:]]*=|api[_-]?key[[:space:]]*=)' \
  policy config actions/project-change-finalize-v1 docs/project-finalization
```

Expected: syntax PASS; grep exits successfully through `!` because there are no matches.

- [ ] **Step 5: Execute Host Actions preflight-only installation check**

On the live control plane, run the new bootstrap in preflight-only mode. Acceptance requires:

```text
PRECHECK_PASS=YES
PRODUCTION_MUTATION=NO
UNKNOWN_BASELINE=NO
SECRET_OUTPUT=NO
```

If the current live runtime SHA differs from the reviewed baseline, stop and produce a fresh read-only baseline diff; never patch through mismatch.

- [ ] **Step 6: Install only after the existing approval flow authorizes it**

After approved installation, open a fresh connector session and verify the action appears in schema. Do not use the same stale connector session as proof of registration.

- [ ] **Step 7: Run Park Bazar finalization pilot on a controlled non-production change**

Pilot acceptance:

```text
PROJECT=park-bazar
DEPLOY_STATE=not_deployed
GIT_SYNC=YES
REMOTE_SHA_VERIFIED=YES
SHEET_UPDATED=YES
SHEET_READBACK_VERIFIED=YES
FINALIZE_PASS=YES
```

Then retry the exact same `change_id` and payload. Acceptance: no duplicate Sheet history/row creation and the same converged result is returned.

- [ ] **Step 8: Record a forced Sheet-failure reconciliation drill**

Use the test/injected transport or a controlled non-production adapter failure, not a destructive production outage. Prove:

```text
CHANGE_STATUS=PARTIAL
FINALIZE_PASS=NO
BLOCKER=SHEET_SYNC_FAILED
```

Restore the adapter and retry the same `change_id`; acceptance is convergence to `FINALIZE_PASS=YES` without a new Git commit.

- [ ] **Step 9: Document pilot evidence**

`docs/project-finalization/pilot-park-bazar.md` records only sanitized request ID/change ID, registry hash, repo/branch, expected/verified SHA, Sheet read-back PASS, timestamps, and final status. No credentials or scanner match contents.

- [ ] **Step 10: Commit pilot evidence and registry readiness**

```bash
git add config/project-registry-v1.json test-project-finalization-orchestrator.js docs/project-finalization/pilot-park-bazar.md
git commit -m "test: validate project finalization pilot"
```

---

## Rollout Sequence After Pilot

Enroll projects in small batches, not all at once:

1. Park Bazar pilot.
2. Gisheh and Solo Company after their Source Mapping gates pass.
3. Single-repo production projects with reliable production SHA evidence.
4. Multi-repo projects such as Honartik/iMotion only after front/back role mapping and production verifiers are established.
5. External cPanel-hosted sites only after their own Source Mapping, backup, Git baseline, and deployment identity model exist.

A project with `finalizer_ready:false` may still be worked on, but a mutating task cannot be reported as fully synchronized/complete through this control plane.

## Final Verification Before Merge

- [ ] Compare implementation branch to its base and verify no unrelated files changed.
- [ ] Run every `test-project-finalization-*.js` and bootstrap regression test listed above.
- [ ] Run `node --check` on every new `.js` file.
- [ ] Verify registry contains no credentials and every enabled project has exact repo/branch/Sheet bindings.
- [ ] Verify direct Git push is disabled for projects without a registered canonical local worktree.
- [ ] Verify production finalization fails closed when production verifier is absent.
- [ ] Verify Sheet write success without matching read-back never yields `FINALIZE_PASS=YES`.
- [ ] Verify `main` is not updated until code review and pilot evidence pass.

## Expected Final Result Contract

A successful non-deployed finalization returns at minimum:

```text
PROJECT=<project_key>
CHANGE_ID=<change_id>
CHANGE_STATUS=COMPLETED
TEST_PASS=YES
GIT_SYNC=YES
REMOTE_SHA_VERIFIED=YES
DEPLOY_STATE=not_deployed
STAGING_SHA_VERIFIED=N/A
PRODUCTION_SHA_VERIFIED=N/A
SHEET_UPDATED=YES
SHEET_READBACK_VERIFIED=YES
FINALIZE_PASS=YES
BLOCKER=NONE
NEXT_GATE=NONE
```

A post-Git Sheet failure returns:

```text
PROJECT=<project_key>
CHANGE_ID=<change_id>
CHANGE_STATUS=PARTIAL
TEST_PASS=YES
GIT_SYNC=YES
REMOTE_SHA_VERIFIED=YES
SHEET_UPDATED=NO
SHEET_READBACK_VERIFIED=NO
FINALIZE_PASS=NO
BLOCKER=SHEET_SYNC_FAILED
NEXT_GATE=RECONCILE_SHEET
```
