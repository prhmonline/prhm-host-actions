# Agent ZDT Baseline Refresh V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and safely execute one fixed bootstrap that updates only the two stale Base/Executor SHA-256 literals inside both byte-identical `agent_zero_downtime_bootstrap_v1` helpers, restoring the existing zero-downtime preflight without restarting services itself.

**Architecture:** The change is an independent recovery bootstrap in `prhmonline/prhm-host-actions`; it is not registered as a new Host Action. The bootstrap has exactly two CLI modes (`--preflight-only`, `--apply`), hard-binds the two target helper paths and all verified before-state SHA values, derives both patched helper bodies in memory, writes atomically with backup/rollback only in apply mode, and never controls a service. Production transport uses the existing DeployHQ project `prhm-host-actions` and server `PRHM Host Bootstrap - node1`; the temporary DeployHQ command is restored to `true` after each execution.

**Tech Stack:** Node.js CommonJS (`/usr/local/bin/prhm-node`), `node:test`, SHA-256 via `node:crypto`, filesystem atomics via `node:fs`, GitHub branch/PR workflow, DeployHQ config-file deployment.

**Spec:** `docs/superpowers/specs/2026-08-20-agent-zdt-baseline-refresh-v1-design.md`

## Global Constraints

- Branch: `design/agent-zdt-baseline-refresh-v1`; never implement on `main`.
- Exactly two production target files may be modified by the bootstrap:
  - `/home/agent/ssh-mcp-server/ops/agent-zdt/agent-zero-downtime-bootstrap-v1.js`
  - `/opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js`
- Both target files must have pre-change SHA-256 `4f1d5a14ae6e13cc25f442dceca7507e8f79088836f4735dcbcad782be126f26` and must be byte-identical before apply.
- Replace only these two stale literals in each helper:
  - `4d4c9f1a8ff9099165f09a4df0c43735a320b20ca1c0f5c27def299a1fcabb25` → `b084b501b2ea572b39336e45673b4d987a6f7cdb10c769a4db3191ce86ca2877`
  - `372083619c6c5dd813e413d2873a9015c647ce3a5cb5037b3c1cc4e671c2b22a` → `5346b24f88c19121898288bd197a8dbe2a18a8c587402cfcd5a27afcfeadacad`
- Seven unrelated protected identities must remain exactly:
  - `/home/agent/ssh-mcp-server/server.js` = `558ff55244f43ac60178a6fec0eddd4068223318b25308d42cdf79d92203098f`
  - `/home/agent/ssh-mcp-server/src/core/registry.js` = `cf3681ca4d4632156df2f77886afe59c07da9a86dbcb68f4217577f811b22231`
  - `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js` = `ebe988fb99794ed3e09b2cefa7496c2d47c967a850b900a117b6b762b388cc34`
  - `/home/agent/ssh-mcp-server/src/plugins/selfmaint.js` = `fcf4420ab9b9c0b540f0e88f923065e16a331580cd238a097b9b1c53db34b2d0`
  - `/home/agent/ssh-agent-api/server.js` = `5c6ffbd60a5347ad2f21352de856bde2033b7ad5b3599301afd3139be8791102`
  - `/opt/prhm-agent-zdt/router.mjs` = `53b904296da0e9d1490bfc7e3ef0b9c1fbad602a1e693141108f016764ebbe78`
  - `/opt/prhm-agent-zdt/api-slot-launcher.cjs` = `d20793dc79ee6d0ffa2ee4bb3b4d5dc1c66750ba0e04f821acb3a45421dcb5ea`
- `--preflight-only` is strictly read-only and returns `production_mutation:false`, `database_mutation:false`, `service_restart_reload:false`.
- `--apply` must rerun the complete preflight immediately before its first write.
- No arbitrary path, host, branch, SHA, command, service, environment value, or extra CLI argument is accepted.
- No `systemctl`, service restart/reload, Router cutover, Blue/Green cutover, DB mutation, application mutation, Git push, credential read, TLS/DNS/payment/SMS mutation is performed by this bootstrap.
- Apply requires a fresh user `CONFIRM_LEVEL_4_CRITICAL` before production execution.
- Backups live under `/var/backups/prhm-agent-zdt-baseline-refresh/` with mode `0700`; rollback is mandatory after any post-first-write failure.

---

### Task 1: RED contract for the recovery bootstrap

**Files:**
- Create: `test-agent-zdt-baseline-refresh-v1.js`
- Future implementation target: `bootstrap-agent-zdt-baseline-refresh-v1.js`

**Interfaces:**
- Consumes: the approved spec constants above.
- Produces: a `node:test` contract that fails while `bootstrap-agent-zdt-baseline-refresh-v1.js` is absent and later validates fixed targets, fixed SHA identities, CLI surface, safety tokens, and absence of service-control capability.

- [ ] **Step 1: Write the failing test**

Create `test-agent-zdt-baseline-refresh-v1.js` with tests that require the bootstrap file to exist and assert at minimum:

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const cp=require('node:child_process');
const file='bootstrap-agent-zdt-baseline-refresh-v1.js';

const TARGET_CANONICAL='/home/agent/ssh-mcp-server/ops/agent-zdt/agent-zero-downtime-bootstrap-v1.js';
const TARGET_INSTALLED='/opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js';
const HELPER_BEFORE='4f1d5a14ae6e13cc25f442dceca7507e8f79088836f4735dcbcad782be126f26';
const BASE_OLD='4d4c9f1a8ff9099165f09a4df0c43735a320b20ca1c0f5c27def299a1fcabb25';
const BASE_NEW='b084b501b2ea572b39336e45673b4d987a6f7cdb10c769a4db3191ce86ca2877';
const EXEC_OLD='372083619c6c5dd813e413d2873a9015c647ce3a5cb5037b3c1cc4e671c2b22a';
const EXEC_NEW='5346b24f88c19121898288bd197a8dbe2a18a8c587402cfcd5a27afcfeadacad';

test('baseline refresh bootstrap exists and is fixed-scope',()=>{
  assert.equal(fs.existsSync(file),true);
  const s=fs.readFileSync(file,'utf8');
  for(const token of [TARGET_CANONICAL,TARGET_INSTALLED,HELPER_BEFORE,BASE_OLD,BASE_NEW,EXEC_OLD,EXEC_NEW,'--preflight-only','--apply']) assert.ok(s.includes(token),token);
  assert.doesNotMatch(s,/systemctl|child_process\.exec\(|execSync\(/);
});

test('unexpected CLI arguments fail before any baseline work',()=>{
  const r=cp.spawnSync(process.execPath,[file,'--bogus'],{encoding:'utf8'});
  assert.notEqual(r.status,0);
  assert.match(String(r.stderr||''),/unexpected_arguments/);
});
```

Add separate assertions for all seven unrelated protected SHA values, backup root `/var/backups/prhm-agent-zdt-baseline-refresh/`, result fields `production_mutation`, `database_mutation`, `service_restart_reload`, and replacement-count guards.

- [ ] **Step 2: Run RED test and verify the failure is for the missing implementation**

Run:

```bash
/usr/local/bin/prhm-node --test test-agent-zdt-baseline-refresh-v1.js
```

Expected: FAIL because `bootstrap-agent-zdt-baseline-refresh-v1.js` does not exist. Do not accept syntax/import errors in the test itself as the RED proof.

- [ ] **Step 3: Commit only the RED test**

```bash
git add test-agent-zdt-baseline-refresh-v1.js
git commit -m "test: define agent zdt baseline refresh contract"
```

### Task 2: GREEN minimal fixed bootstrap

**Files:**
- Create: `bootstrap-agent-zdt-baseline-refresh-v1.js`
- Test: `test-agent-zdt-baseline-refresh-v1.js`

**Interfaces:**
- Consumes: fixed target paths, before-state hashes, the two old→new literal pairs, seven unrelated protected hashes.
- Produces: CLI modes `--preflight-only` and `--apply`; bounded JSON result with action `agent_zdt_baseline_refresh_v1`.

- [ ] **Step 1: Implement argument validation before filesystem baseline work**

The first behavioral gate after module initialization must reject anything except exactly one of:

```text
--preflight-only
--apply
```

No default mode and no second argument are allowed.

- [ ] **Step 2: Implement fixed read-only baseline and candidate derivation**

Implement focused helpers equivalent in style to existing Host Actions bootstraps:

```js
function fail(message){ throw new Error(message); }
function shaBuf(bytes){ return crypto.createHash('sha256').update(bytes).digest('hex'); }
function shaFile(file){ return shaBuf(fs.readFileSync(file)); }
function safeRegular(file){ const s=fs.lstatSync(file); return s.isFile()&&!s.isSymbolicLink(); }
function count(text,needle){ return text.split(needle).length-1; }
function replaceExactlyOnce(text,oldValue,newValue,label){
  if(count(text,oldValue)!==1) fail('replacement_count_invalid:'+label);
  if(count(text,newValue)!==0) fail('new_literal_already_present:'+label);
  return text.replace(oldValue,newValue);
}
```

The baseline must verify root UID, both helper SHA values, helper byte identity, all seven unrelated hashes, regular-file/no-symlink status, and `/usr/local/bin/prhm-node` existence. Derive each candidate entirely in memory, replacing only `BASE_OLD→BASE_NEW` and `EXEC_OLD→EXEC_NEW`, then assert both candidate byte strings are identical.

- [ ] **Step 3: Validate candidate syntax without writing production targets**

Write each candidate only to a private temporary file under `/tmp` with mode `0600`, execute:

```bash
/usr/local/bin/prhm-node --check <tempfile>
```

and delete the temporary file in `finally`. Verify the candidate old-literal counts are zero and each new literal occurs exactly once in its corresponding `EXPECTED_SHA` entry.

- [ ] **Step 4: Implement bounded preflight JSON**

`--preflight-only` must emit one JSON object with:

```json
{
  "ok": true,
  "action": "agent_zdt_baseline_refresh_v1",
  "preflight_only": true,
  "production_mutation": false,
  "database_mutation": false,
  "service_restart_reload": false,
  "target_count": 2,
  "target_sha_match": true,
  "runtime_baseline_match": true,
  "other_protected_sha_match": true,
  "replacement_count_per_file": 2,
  "candidate_syntax_ok": true
}
```

It may additionally include only non-secret SHA-256 values and boolean verification fields. It must not print file contents, environment values, remote URLs, tokens, credentials, DSNs, or command output.

- [ ] **Step 5: Implement apply with backup, atomic write, verification, and rollback**

`--apply` reruns the same baseline and candidate validation, then:

1. creates `/var/backups/prhm-agent-zdt-baseline-refresh/<timestamp>/` mode `0700`;
2. copies both original helper files there before the first production write;
3. records a bounded manifest containing paths, modes, owners, and SHA-256 only;
4. writes each target using a same-directory temporary file, `fsync`, original mode/owner preservation, then atomic `rename`;
5. syntax-checks both installed files;
6. verifies both resulting target files are byte-identical;
7. verifies both old literals are absent, each new literal occurs exactly once, and all seven unrelated protected SHA values remain unchanged;
8. returns success JSON with `production_mutation:true`, `database_mutation:false`, `service_restart_reload:false`, `rollback_performed:false`.

If any error occurs after the first production write, restore both originals atomically from the already-created backups, verify both restored SHA values equal `4f1d5a14ae6e13cc25f442dceca7507e8f79088836f4735dcbcad782be126f26`, and only then emit/throw a bounded rollback failure or success state.

- [ ] **Step 6: Run GREEN tests and syntax checks**

Run:

```bash
/usr/local/bin/prhm-node --check bootstrap-agent-zdt-baseline-refresh-v1.js
/usr/local/bin/prhm-node --test test-agent-zdt-baseline-refresh-v1.js
```

Expected: both PASS.

- [ ] **Step 7: Commit bootstrap implementation**

```bash
git add bootstrap-agent-zdt-baseline-refresh-v1.js test-agent-zdt-baseline-refresh-v1.js
git commit -m "feat: add agent zdt baseline refresh bootstrap"
```

### Task 3: Pin resulting helper identity and complete regression verification

**Files:**
- Modify: `test-agent-zdt-baseline-refresh-v1.js`
- Verify: `bootstrap-agent-zdt-baseline-refresh-v1.js`

**Interfaces:**
- Consumes: the deterministic candidate body returned by the implemented replacement logic.
- Produces: an exact `RESULTING_HELPER_SHA` assertion that must match both patched helper files in production before the later zero-downtime action is requested.

- [ ] **Step 1: Derive the candidate SHA from the reviewed branch artifact without touching production**

Use a local Node one-liner or a test helper that reads a checked-in fixture copy of the current 17,812-byte helper body only if such fixture is added in this task; do not query or modify production for this derivation. The derivation must perform only the two approved replacements and print only SHA-256 plus byte count.

- [ ] **Step 2: Pin the exact emitted SHA in the test**

Add `RESULTING_HELPER_SHA='<exact 64-hex value emitted in Step 1>'` to the test and require the bootstrap source to contain that exact value as its post-write expected helper identity. This value must not be guessed or manually transformed.

- [ ] **Step 3: Add negative contract checks**

Tests must reject implementations that:
- contain any `systemctl` token;
- accept extra CLI arguments;
- omit any of the seven unrelated protected hashes;
- lack both before-target SHA guards;
- lack rollback verification against the original helper SHA;
- lack the final exact resulting helper SHA verification.

- [ ] **Step 4: Re-run full branch tests**

```bash
/usr/local/bin/prhm-node --check bootstrap-agent-zdt-baseline-refresh-v1.js
/usr/local/bin/prhm-node --test test-agent-zdt-baseline-refresh-v1.js
```

Expected: PASS with no warnings/errors.

- [ ] **Step 5: Commit the pinned identity**

```bash
git add test-agent-zdt-baseline-refresh-v1.js bootstrap-agent-zdt-baseline-refresh-v1.js
git commit -m "test: pin agent zdt refreshed helper identity"
```

### Task 4: DeployHQ preflight-only validation

**Files / external configuration:**
- Deploy artifact: `bootstrap-agent-zdt-baseline-refresh-v1.js`
- Existing DeployHQ project: `prhm-host-actions`
- Existing DeployHQ server: `PRHM Host Bootstrap - node1` (`9679b8ca-fe66-4f79-881f-5513b52fd100`)
- Target path: `/root/bootstrap-agent-zdt-baseline-refresh-v1.js`

**Interfaces:**
- Consumes: reviewed bootstrap bytes from the branch and their exact SHA-256.
- Produces: live read-only preflight evidence; no helper mutation.

- [ ] **Step 1: Add/update one temporary DeployHQ config-file artifact from the exact reviewed bootstrap bytes**

Bind the DeployHQ config file to `/root/bootstrap-agent-zdt-baseline-refresh-v1.js` on `PRHM Host Bootstrap - node1`. Do not change repository branch settings or server connection settings.

- [ ] **Step 2: Temporarily set exactly one DeployHQ after-changes command for preflight**

Use exactly:

```bash
/usr/local/bin/prhm-node /root/bootstrap-agent-zdt-baseline-refresh-v1.js --preflight-only
```

with halt-on-error enabled. Do not reuse retired commands for anything except changing one selected command from `true` to this exact invocation and restoring it afterward.

- [ ] **Step 3: Queue a config-file deployment and verify preflight contract**

Require deployment completion and result fields:

```text
ok=true
preflight_only=true
production_mutation=false
database_mutation=false
service_restart_reload=false
target_count=2
target_sha_match=true
runtime_baseline_match=true
other_protected_sha_match=true
replacement_count_per_file=2
candidate_syntax_ok=true
```

Any mismatch is a hard stop. Do not proceed to apply.

- [ ] **Step 4: Immediately restore the temporary DeployHQ command to `true` and verify it**

Do this whether preflight passes or fails.

- [ ] **Step 5: Read-only reverify public MCP health and the two target helper SHA values**

Expected before apply: public MCP on `8123` remains healthy and both helper files still have SHA `4f1d5a14ae6e13cc25f442dceca7507e8f79088836f4735dcbcad782be126f26`.

### Task 5: Production apply gate and post-refresh handoff

**Files / external configuration:**
- Same DeployHQ artifact and server from Task 4.
- No Git merge is required before apply; execution is bound to the reviewed artifact bytes and pinned SHA.

**Interfaces:**
- Consumes: a PASS from Task 4 plus a fresh explicit user `CONFIRM_LEVEL_4_CRITICAL` for this exact baseline-refresh apply.
- Produces: two byte-identical refreshed helpers with the pinned resulting helper SHA; no service restart/cutover.

- [ ] **Step 1: Stop and obtain a fresh Level-4 confirmation**

Do not reuse any previous Level-4 confirmation from another request/action. The user must explicitly confirm this exact production baseline-refresh apply after Task 4 has passed.

- [ ] **Step 2: Temporarily set the exact DeployHQ apply command**

```bash
/usr/local/bin/prhm-node /root/bootstrap-agent-zdt-baseline-refresh-v1.js --apply
```

- [ ] **Step 3: Queue one config-file deployment and require the success contract**

Require:

```text
ok=true
action=agent_zdt_baseline_refresh_v1
preflight_only=false
production_mutation=true
database_mutation=false
service_restart_reload=false
target_count=2
rollback_performed=false
```

and require both resulting helper hashes to equal the pinned `RESULTING_HELPER_SHA` from Task 3.

- [ ] **Step 4: Restore the DeployHQ command to `true` immediately and verify it**

This happens on both success and failure paths.

- [ ] **Step 5: Verify live helper hashes and public MCP health read-only**

Both canonical and installed zero-downtime helper files must be byte-identical and match `RESULTING_HELPER_SHA`; public MCP health on `8123` must remain healthy. No MCP/API service should have been restarted by the baseline-refresh bootstrap.

- [ ] **Step 6: Create, but do not auto-apply, a fresh `agent_zero_downtime_bootstrap_v1` Level-4 request**

The subsequent zero-downtime migration is a separate protected action. Its fresh request must pass the now-repaired SHA preflight and requires its own explicit `CONFIRM_LEVEL_4_CRITICAL` before apply.

- [ ] **Step 7: After the later zero-downtime action succeeds, run the Source Mapping V2 sentinel and close Park Bazar/Gisheh gates**

This is downstream verification, not part of the baseline-refresh mutation itself.
