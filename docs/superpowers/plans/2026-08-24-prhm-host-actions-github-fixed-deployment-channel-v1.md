# PRHM Host Actions GitHub Fixed Deployment Channel V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and fully test the repository-side components for a GitHub-hosted, zero-runtime-input, forced-command SSH delivery channel that can invoke only the fixed `root_scripts_fixed_stage_promotion_v1` bootstrap operation, while stopping before any production trust-anchor installation or server mutation.

**Architecture:** The repository produces three narrowly separated assets: a server-side fixed dispatcher, a build-time sealing generator that embeds reviewed SSH/public-host identity into immutable bootstrap/workflow outputs, and a zero-input GitHub Actions workflow that can only connect with the dedicated forced-command key. Runtime callers cannot select a host, path, command, content, SHA, service, database, or action. All filesystem mutation logic is exercised against local fixtures first, including automatic rollback; creating the real SSH principal, installing `authorized_keys`, creating the GitHub secret, and performing the first production promotion remain behind a separate explicit execution gate.

**Tech Stack:** Node.js CommonJS with `node:test` and `node:assert/strict`, OpenSSH forced-command semantics, GitHub Actions YAML, SHA-256 via `node:crypto`, atomic filesystem replacement via Node `fs`, existing PRHM Host Actions Level-4 control-plane.

**Spec:** `docs/superpowers/specs/2026-08-24-prhm-host-actions-github-fixed-deployment-channel-design.md`

## Global Constraints

- Fixed operation name: `root_scripts_fixed_stage_promotion_v1`.
- Fixed source identity: `agent_api/root-stage-fixed-v1.candidate.txt`.
- Fixed source SHA-256: `22181213d9c6a1b5982778530a9b674782f6de023e6ed75f915366f995eb5bd8`.
- Fixed production target: `/opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js`.
- Fixed expected target preimage SHA-256: `50c07d21fb2def962e6f801663f3293ce7c25ba00a410caa039792832910c5ee`.
- The fixed dispatcher accepts no runtime path, command, content, destination, SHA, service, SQL, host, environment, or arbitrary JSON input.
- The SSH key entry must include `no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty` and one fixed `command="..."` forced command.
- The dedicated SSH principal must never provide an interactive shell through this key; any non-empty `SSH_ORIGINAL_COMMAND` is rejected.
- GitHub Actions runtime inputs are empty. No `workflow_dispatch.inputs` are allowed in V1.
- GitHub workflow permissions are minimized; because the workflow only opens the fixed SSH transport and transfers no repository payload, use `permissions: {}` unless implementation evidence proves `contents: read` is required.
- `StrictHostKeyChecking=no`, `UserKnownHostsFile=/dev/null`, generic `ssh <host> <command>`, generic SCP/SFTP/upload, and generic shell execution on the server are prohibited.
- GitHub does not replace PRHM Level-4 approval. After the capability is installed, critical control-plane execution still uses `host_action_v2_request` -> explicit `CONFIRM_LEVEL_4_CRITICAL` -> `host_action_v2_apply`.
- No DrTarjomeh production application file, database, payment configuration, SMS/email configuration, or staging clone may be modified by this implementation.
- This plan ends with repository TDD evidence and a reviewable branch/PR. It does **not** create the production SSH principal, install an authorized key, create a GitHub Actions secret, modify the control-plane host, or execute the promotion.
- Do not guess live host identity, SSH endpoint, port, host key, account state, or server path ownership. The separate execution gate must discover and pin them from fresh evidence before sealing production artifacts.

---

### Task 1: Fixed Dispatcher Contract and RED Baseline

**Files:**
- Create: `prhm-host-actions-github-fixed-dispatcher-v1.js`
- Create: `test-v17-github-fixed-deployment-dispatcher.js`

**Interfaces:**
- Consumes: no runtime caller parameters; server-local fixed source/target identities from the spec.
- Produces: module exports `CONTRACT`, `validateInvocation(argv, env)`, `createDispatcher(ops)`, and CLI `main()`.

- [ ] **Step 1: Write the failing dispatcher contract test**

Create `test-v17-github-fixed-deployment-dispatcher.js` with the initial contract assertions:

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const dispatcherPath=path.join(__dirname,'prhm-host-actions-github-fixed-dispatcher-v1.js');

test('fixed dispatcher exposes only the approved promotion contract',()=>{
  assert.equal(fs.existsSync(dispatcherPath),true,'dispatcher must exist');
  const d=require(dispatcherPath);
  assert.deepEqual(d.CONTRACT,{
    schema_version:'prhm.github-fixed-deployment.v1',
    action:'root_scripts_fixed_stage_promotion_v1',
    source:'agent_api/root-stage-fixed-v1.candidate.txt',
    source_sha256:'22181213d9c6a1b5982778530a9b674782f6de023e6ed75f915366f995eb5bd8',
    target:'/opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js',
    target_preimage_sha256:'50c07d21fb2def962e6f801663f3293ce7c25ba00a410caa039792832910c5ee'
  });
  assert.throws(()=>d.validateInvocation(['node','dispatcher','anything'],{}),/unexpected_arguments/);
  assert.throws(()=>d.validateInvocation(['node','dispatcher'],{SSH_ORIGINAL_COMMAND:'id'}),/unexpected_original_command/);
  assert.doesNotThrow(()=>d.validateInvocation(['node','dispatcher'],{}));
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
node test-v17-github-fixed-deployment-dispatcher.js
```

Expected: FAIL with `dispatcher must exist`.

- [ ] **Step 3: Implement the minimal fixed contract**

Create `prhm-host-actions-github-fixed-dispatcher-v1.js` with literal constants and zero-input validation:

```js
'use strict';
const CONTRACT=Object.freeze({
  schema_version:'prhm.github-fixed-deployment.v1',
  action:'root_scripts_fixed_stage_promotion_v1',
  source:'agent_api/root-stage-fixed-v1.candidate.txt',
  source_sha256:'22181213d9c6a1b5982778530a9b674782f6de023e6ed75f915366f995eb5bd8',
  target:'/opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js',
  target_preimage_sha256:'50c07d21fb2def962e6f801663f3293ce7c25ba00a410caa039792832910c5ee'
});
function validateInvocation(argv=process.argv,env=process.env){
  if(argv.length!==2)throw new Error('unexpected_arguments');
  if(String(env.SSH_ORIGINAL_COMMAND||'').trim()!=='')throw new Error('unexpected_original_command');
  return true;
}
module.exports={CONTRACT,validateInvocation};
```

Do not implement mutation yet.

- [ ] **Step 4: Run GREEN for the contract**

Run:

```bash
node test-v17-github-fixed-deployment-dispatcher.js
```

Expected: PASS for the contract test.

- [ ] **Step 5: Commit**

```bash
git add prhm-host-actions-github-fixed-dispatcher-v1.js test-v17-github-fixed-deployment-dispatcher.js
git commit -m "test: define fixed GitHub deployment dispatcher contract"
```

---

### Task 2: Atomic Promotion, Verification, and Rollback in Fixtures

**Files:**
- Modify: `prhm-host-actions-github-fixed-dispatcher-v1.js`
- Modify: `test-v17-github-fixed-deployment-dispatcher.js`

**Interfaces:**
- Consumes: `CONTRACT` and an injected operations object `{readFile, writeExclusive, rename, fsyncFile, fsyncDir, stat, sha256File, nodeCheck, executorHealth, restartExecutor, now}`.
- Produces: `createDispatcher(ops)` returning `{preflight(), apply()}` and sanitized result objects with `ok`, `action`, `before_sha256`, `after_sha256`, `rollback_performed`, and `verification`.

- [ ] **Step 1: Add failing preflight and rollback tests**

Extend the test file with temporary fixture directories and deterministic fake operations. The tests must cover at least these RED cases:

```js
for(const name of [
  'source_sha_mismatch','target_sha_mismatch','source_symlink','target_symlink',
  'candidate_syntax_failure','executor_unhealthy'
]){
  test(`preflight denies ${name}`,()=>{
    const fx=fixtureFor(name);
    const d=require(dispatcherPath).createDispatcher(fx.ops);
    assert.throws(()=>d.preflight(),new RegExp(name));
    assert.equal(fx.mutations.length,0);
  });
}

test('post-write verification failure restores exact preimage',()=>{
  const fx=fixtureFor('post_write_health_failure');
  const d=require(dispatcherPath).createDispatcher(fx.ops);
  const result=d.apply();
  assert.equal(result.ok,false);
  assert.equal(result.rollback_performed,true);
  assert.equal(fx.currentTargetSha(),require(dispatcherPath).CONTRACT.target_preimage_sha256);
});
```

Implement `fixtureFor()` in the test file itself; it must never touch production paths and must record each mutation so ordering is assertable.

- [ ] **Step 2: Run RED**

```bash
node test-v17-github-fixed-deployment-dispatcher.js
```

Expected: FAIL because `createDispatcher` is absent.

- [ ] **Step 3: Implement fail-closed preflight**

In `createDispatcher(ops).preflight()` enforce this exact ordering before any write:

1. source is regular and not symlink;
2. source SHA equals `CONTRACT.source_sha256`;
3. target is regular and not symlink;
4. target SHA equals `CONTRACT.target_preimage_sha256`;
5. candidate passes `nodeCheck`;
6. executor baseline health returns `ok:true` and includes `root_scripts_fixed_stage_v1`.

Any failure must throw before `writeExclusive` is called.

- [ ] **Step 4: Implement backup and atomic replacement**

The minimal mutation sequence is:

```text
preflight
-> read exact target preimage
-> write backup with exclusive creation
-> write sibling temporary candidate with exclusive creation
-> fsync temporary candidate
-> rename temporary candidate over target
-> fsync containing directory
-> verify target SHA equals source SHA
-> nodeCheck installed target
-> restartExecutor only if required by the live runtime contract
-> executorHealth
```

The production implementation must not derive source or target from arguments or environment variables.

- [ ] **Step 5: Implement automatic rollback**

If any step after the target rename fails, restore the exact captured preimage through a sibling temporary file and atomic rename, fsync the containing directory, verify the restored SHA equals `CONTRACT.target_preimage_sha256`, and re-run executor health. Return `FAILED_ROLLED_BACK` only after rollback verification succeeds; if rollback verification fails, return/throw `rollback_verification_failed` and never report success.

- [ ] **Step 6: Add one-time/idempotence behavior**

Add tests proving that if target SHA already equals `CONTRACT.source_sha256`, the dispatcher returns:

```js
{ok:true,action:'root_scripts_fixed_stage_promotion_v1',already_applied:true,mutation:false}
```

and performs no backup/write/restart.

- [ ] **Step 7: Run GREEN**

```bash
node test-v17-github-fixed-deployment-dispatcher.js
```

Expected: all dispatcher tests PASS, including rollback injection.

- [ ] **Step 8: Commit**

```bash
git add prhm-host-actions-github-fixed-dispatcher-v1.js test-v17-github-fixed-deployment-dispatcher.js
git commit -m "feat: add fixed dispatcher atomic promotion rollback"
```

---

### Task 3: Build-Time Sealing Generator for the Trust Anchor

**Files:**
- Create: `generate-github-fixed-deployment-channel-v1.js`
- Create: `test-v17-github-fixed-deployment-seal.js`

**Interfaces:**
- Consumes at **build/review time only**: one OpenSSH Ed25519 public key line, one verified SSH hostname, one verified integer SSH port, and one verified Ed25519 host public-key line. These values are not accepted by the deployed dispatcher or workflow at runtime.
- Produces: deterministic `{authorizedKeysLine, workflowYaml, bootstrapSource, manifest}` where all endpoint/key values are embedded literals and the manifest carries SHA-256 hashes for every generated artifact.

- [ ] **Step 1: Write RED validation tests for sealing inputs**

Create tests proving the generator rejects:

```js
[
  'non-ed25519 deploy key',
  'deploy public key containing newline',
  'empty hostname',
  'hostname containing whitespace or shell metacharacters',
  'port outside 1..65535',
  'non-ed25519 host key',
  'host key containing newline'
]
```

Also require deterministic output: same validated inputs must generate byte-identical outputs and identical manifest hashes.

- [ ] **Step 2: Run RED**

```bash
node test-v17-github-fixed-deployment-seal.js
```

Expected: FAIL because the generator does not exist.

- [ ] **Step 3: Implement `validateSealInput()`**

The interface is exact:

```js
validateSealInput({deployPublicKey,sshHost,sshPort,hostPublicKey})
```

Validation rules:

- `deployPublicKey` starts with `ssh-ed25519 ` and is exactly one line;
- `hostPublicKey` starts with `ssh-ed25519 ` and is exactly one line;
- `sshHost` matches `/^[A-Za-z0-9.-]+$/`;
- `sshPort` is an integer from 1 through 65535;
- no value is accepted from `process.env` implicitly.

- [ ] **Step 4: Generate the fixed authorized key line**

The generated line must have the exact restriction prefix:

```text
no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty,command="/usr/local/bin/prhm-node /usr/local/libexec/prhm-host-actions-github-fixed-dispatcher-v1.js"
```

followed by exactly one space and the validated Ed25519 public key. No caller command substitution is allowed.

- [ ] **Step 5: Generate a root-owned trust-anchor bootstrap source**

The generated bootstrap source must be deterministic and fixed to:

- dedicated account name `prhm-host-actions-deploy`;
- dispatcher install path `/usr/local/libexec/prhm-host-actions-github-fixed-dispatcher-v1.js`;
- authorized-keys location under that dedicated account only;
- password locked/disabled for the account;
- exact file/directory modes checked before completion;
- exact embedded dispatcher SHA checked after install;
- no edits to unrelated SSH accounts or unrelated authorized keys;
- backup and rollback for any file it changes;
- a `--preflight-only` mode that performs no writes and is testable against injected fixtures.

Do not add an arbitrary `--user`, `--path`, `--key`, `--host`, `--command`, or `--file` option.

- [ ] **Step 6: Run GREEN**

```bash
node test-v17-github-fixed-deployment-seal.js
```

Expected: PASS with deterministic artifact hashes.

- [ ] **Step 7: Commit**

```bash
git add generate-github-fixed-deployment-channel-v1.js test-v17-github-fixed-deployment-seal.js
git commit -m "feat: add deterministic fixed channel sealing generator"
```

---

### Task 4: Zero-Input GitHub Workflow and Static Security Tests

**Files:**
- Modify: `generate-github-fixed-deployment-channel-v1.js`
- Modify: `test-v17-github-fixed-deployment-seal.js`
- Generated only after fresh endpoint/key evidence in the later execution gate: `.github/workflows/prhm-host-actions-fixed-deploy-v1.yml`

**Interfaces:**
- Consumes: sealed literal host/port/host-key values from Task 3 and only the repository secret name `PRHM_HOST_ACTIONS_DEPLOY_KEY`.
- Produces: zero-input GitHub workflow text with no server-side command argument.

- [ ] **Step 1: Add RED static workflow assertions**

The generated YAML must satisfy all of these source-level checks:

```js
assert.match(yaml,/workflow_dispatch:\s*\n/);
assert.doesNotMatch(yaml,/workflow_dispatch:[\s\S]*?inputs:/);
assert.match(yaml,/permissions:\s*\{\}/);
assert.doesNotMatch(yaml,/pull_request_target:|\npush:|\nschedule:/);
assert.match(yaml,/secrets\.PRHM_HOST_ACTIONS_DEPLOY_KEY/);
assert.doesNotMatch(yaml,/StrictHostKeyChecking=no|UserKnownHostsFile=\/dev\/null/);
assert.doesNotMatch(yaml,/scp\s|sftp\s|rsync\s/);
assert.doesNotMatch(yaml,/ssh[^\n]*\s['\"]?[A-Za-z0-9_./-]+['\"]?\s*$/m); // no remote command payload
```

Also assert there are no references to `${{ inputs.` anywhere.

- [ ] **Step 2: Implement the workflow generator**

The generated workflow must:

1. run only on manual `workflow_dispatch`;
2. use `permissions: {}`;
3. materialize `secrets.PRHM_HOST_ACTIONS_DEPLOY_KEY` into a `0600` file under `$RUNNER_TEMP` with `umask 077`;
4. materialize the sealed literal host public key into `$RUNNER_TEMP/known_hosts`;
5. use `BatchMode=yes`, `IdentitiesOnly=yes`, `StrictHostKeyChecking=yes`, and the generated known-hosts file;
6. connect as `prhm-host-actions-deploy` to the sealed host/port;
7. provide **no remote command** so the forced command is the only server-side executable path;
8. remove the temporary key file in an `if: always()` cleanup step;
9. never print the private key or enable shell tracing.

- [ ] **Step 3: Add a manifest integrity check**

The sealing generator must produce `manifest.schema_version='prhm.github-fixed-deployment-seal.v1'` and SHA-256 values for dispatcher bytes, bootstrap bytes, authorized-key line bytes, and workflow bytes. Static tests recompute all hashes and require exact equality.

- [ ] **Step 4: Run GREEN**

```bash
node test-v17-github-fixed-deployment-seal.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add generate-github-fixed-deployment-channel-v1.js test-v17-github-fixed-deployment-seal.js
git commit -m "feat: generate zero-input fixed deployment workflow"
```

---

### Task 5: End-to-End Local Fixture and Security Regression Suite

**Files:**
- Create: `test-v17-github-fixed-deployment-e2e.js`
- Modify: `prhm-host-actions-github-fixed-dispatcher-v1.js`
- Modify: `generate-github-fixed-deployment-channel-v1.js`

**Interfaces:**
- Consumes: dispatcher and sealing generator from Tasks 1-4.
- Produces: one local-only end-to-end test proving transport configuration, forced-command restrictions, fixed promotion semantics, and rollback without production mutation.

- [ ] **Step 1: Write the E2E RED test**

The test constructs a temporary filesystem containing only fixture source/target files, generates a sealed channel using deterministic fixture Ed25519 public-key strings, and passes the fixed dispatcher injected filesystem operations. It must assert:

```text
unknown runtime command -> deny
non-empty SSH_ORIGINAL_COMMAND -> deny
source SHA mismatch -> deny before write
target SHA mismatch -> deny before write
source symlink -> deny
target symlink -> deny
candidate syntax failure -> deny
baseline health failure -> deny
valid fixture -> exact backup + atomic replacement + exact final SHA
injected post-write failure -> exact rollback + restored SHA
second execution -> already_applied with zero mutation
workflow -> zero runtime inputs
workflow -> no generic upload or remote command
forced authorized key -> all four forwarding/pty restrictions present
```

- [ ] **Step 2: Run RED**

```bash
node test-v17-github-fixed-deployment-e2e.js
```

Expected: FAIL until the modules expose the exact dependency-injection interfaces used by the E2E test.

- [ ] **Step 3: Make only minimal interface adjustments**

Export only the pure/testable functions needed by the E2E suite. Do not add runtime configuration knobs. In particular, production source, target, action, and SHA constants remain literals in `CONTRACT`.

- [ ] **Step 4: Run the complete V17 suite**

```bash
node test-v17-github-fixed-deployment-dispatcher.js
node test-v17-github-fixed-deployment-seal.js
node test-v17-github-fixed-deployment-e2e.js
node --check prhm-host-actions-github-fixed-dispatcher-v1.js
node --check generate-github-fixed-deployment-channel-v1.js
```

Expected: all tests PASS and both syntax checks exit 0.

- [ ] **Step 5: Run prohibited-pattern regression**

```bash
rg -n "StrictHostKeyChecking=no|UserKnownHostsFile=/dev/null|sshpass|scp |sftp |rsync |process\.env\.(TARGET|SOURCE|COMMAND|HOST)|child_process\.exec\(" \
  prhm-host-actions-github-fixed-dispatcher-v1.js \
  generate-github-fixed-deployment-channel-v1.js \
  test-v17-github-fixed-deployment-*.js
```

Expected: no production implementation hit. Test assertions may contain the prohibited strings only when explicitly checking their absence.

- [ ] **Step 6: Commit**

```bash
git add prhm-host-actions-github-fixed-dispatcher-v1.js generate-github-fixed-deployment-channel-v1.js test-v17-github-fixed-deployment-*.js
git commit -m "test: prove fixed GitHub deployment channel end to end"
```

---

### Task 6: Review Branch, Evidence Bundle, and Stop Before Production

**Files:**
- No production file creation.
- Review only the files created in Tasks 1-5 plus the approved spec and this plan.

**Interfaces:**
- Consumes: GREEN V17 test suite.
- Produces: reviewable Git branch/PR and an evidence summary; no trust anchor or server mutation.

- [ ] **Step 1: Implement on an isolated branch/worktree**

At execution time use `superpowers:using-git-worktrees` and create an isolated branch named:

```text
integration/github-fixed-deployment-channel-v1
```

Do not implement directly on `main`.

- [ ] **Step 2: Re-run the complete verification suite from a clean checkout**

```bash
node test-v17-github-fixed-deployment-dispatcher.js
node test-v17-github-fixed-deployment-seal.js
node test-v17-github-fixed-deployment-e2e.js
node --check prhm-host-actions-github-fixed-dispatcher-v1.js
node --check generate-github-fixed-deployment-channel-v1.js
git status --short
```

Expected: tests PASS, syntax checks exit 0, and only intentional branch changes are present.

- [ ] **Step 3: Review diff against the approved spec**

Verify explicitly that the diff introduces none of the following:

```text
arbitrary server command input
arbitrary path/content/SHA input
interactive SSH shell
port/agent/X11 forwarding
GitHub workflow runtime inputs
server-side generic upload
DrTarjomeh app/database mutation
Level-4 approval bypass
production trust-anchor installation
```

- [ ] **Step 4: Open a draft PR**

Create a draft PR from `integration/github-fixed-deployment-channel-v1` to `main` titled:

```text
GitHub fixed deployment channel V1: repository-side TDD
```

The PR body must state that production SSH principal creation, GitHub secret creation, server bootstrap installation, and the first fixed promotion are intentionally **not executed** by this PR.

- [ ] **Step 5: Stop at the production boundary**

Do not create the real keypair, GitHub Actions secret, dedicated SSH user, authorized-key entry, workflow generated with live endpoint values, or server dispatcher in this plan execution.

The next explicit execution gate is:

```text
NEXT_GATE=PRHM_HOST_ACTIONS_GITHUB_FIXED_DEPLOYMENT_TRUST_ANCHOR_INSTALL_V1
```

That later gate must freshly discover and pin the actual SSH endpoint, port, host Ed25519 key, host identity, account state, and relevant ownership/mode baselines; generate the production-sealed artifacts; create a request/hash-bound approval for the trust-anchor mutation; install it through a sanctioned out-of-band channel; verify the forced-command behavior non-destructively; and only then permit a separate first-promotion request.

---

## Plan Self-Review Checklist

Before claiming this implementation plan complete:

1. **Spec coverage:** Tasks 1-2 cover fixed promotion semantics, preflight, atomic replacement, verification, idempotence, and rollback. Tasks 3-4 cover the dedicated SSH forced-command boundary, deterministic sealing, minimal GitHub permissions, zero runtime inputs, host-key verification, and secret-handling rules. Task 5 covers the RED/GREEN acceptance matrix. Task 6 preserves the separate production execution gate and Level-4 boundary.
2. **Placeholder scan:** The plan contains no unresolved placeholders, guessed host/port/key value, deferred implementation markers, or unbound production destination. Live endpoint/key values are deliberately discovered only in the separate execution gate and are never guessed.
3. **Interface consistency:** `CONTRACT`, `validateInvocation(argv, env)`, `createDispatcher(ops)`, and `validateSealInput({deployPublicKey,sshHost,sshPort,hostPublicKey})` are the only named implementation interfaces shared across tasks.
4. **Scope:** Repository TDD and artifact generation only. Production SSH, GitHub secret, control-plane mutation, DrTarjomeh mutation, and actual promotion remain outside this plan execution.
