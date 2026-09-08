# iMotion DirectAdmin Account v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, verify, install, and execute one fixed SHA-bound DirectAdmin action that creates only user `imotion` with primary domain `imotion.ir` on `10.71.0.10` after a fresh Level-4 approval.

**Architecture:** Keep the production mutation artifact generated from actual zero-input preflight evidence. The generator embeds target/fingerprint/admin/version/ownership preconditions, the action revalidates them immediately before mutation, uses `da api-url` only in memory, performs one official DirectAdmin API create, verifies exact readback, and rolls back only the user created by its own invocation.

**Tech Stack:** Node.js (`node:test`, `assert`, `crypto`, `child_process`), DirectAdmin root CLI (`da api-url`, `da admin`, `da version`, `da taskq`) and DirectAdmin legacy API (`CMD_API_ACCOUNT_USER`, `CMD_API_SHOW_ALL_USERS`, `CMD_API_SHOW_USER_CONFIG`, `CMD_API_SELECT_USERS`).

**Spec:** `docs/superpowers/specs/2026-09-08-imotion-directadmin-account-v1-design.md`

## Global Constraints
- Target is exactly `10.71.0.10`; never contact `10.71.0.117`.
- Create exactly one DirectAdmin user `imotion` with primary domain `imotion.ir`.
- No DirectAdmin admin password is accepted or stored.
- Current iMotion production runtime stays untouched until later migration verification/cutover.
- No broad/raw write, policy downgrade, force push, or bypass.
- Rollback may remove only artifacts proven created by this invocation and only while bound preconditions still match.
- DirectAdmin mutation requires one fresh Level-4 approval bound to exact action SHA and current preflight evidence.
- Every code/file change must be committed/pushed; DONE requires Git/runtime SHA parity.

---

### Task 1: Canonical actual preflight evidence

**Files:**
- Read only: existing MCP registration `imotion_directadmin_preflight_v1`
- Produce at runtime only: sanitized preflight evidence object; no secret file

**Interfaces:**
- Consumes: zero runtime inputs.
- Produces: `{target, host_key_fingerprint, directadmin_version, admin_user, service_active, port_2222_listening, api_url_capable, login_url_capable, taskq_capable, db_client, user_imotion_absent, domain_owners}`.

- [ ] **Step 1: Execute the actual zero-input tool**

Run through canonical `Mohammad SSH Agent 2`: `imotion_directadmin_preflight_v1()`.
Expected: `ok=true`, target `10.71.0.10`, no mutation, `imotion` absent, all fixed iMotion domains unowned by conflicting users.

- [ ] **Step 2: Fail closed on any precondition mismatch**

Do not generate or install the production action if any required evidence is false, missing, ambiguous, or points to `10.71.0.117`.

### Task 2: RED contract for the bound action generator/runtime

**Files:**
- Create: `test-imotion-directadmin-account-v1.js`
- Later create: `imotion-directadmin-account-v1.js`

**Interfaces:**
- Consumes: fixture preflight evidence and injected DirectAdmin adapter.
- Produces: failing tests defining `buildBoundSpec(evidence)`, `preflightWithAdapter(spec, adapter)`, `applyWithAdapter(spec, adapter)`.

- [ ] **Step 1: Write failing tests**

Tests must require the missing implementation and assert: fixed target/user/domain, no runtime inputs, wrong target/fingerprint/admin/version rejection, absent-user/domain-owner guards, no secret leakage, exact one create call, guarded rollback, rollback drift rejection, and critical rollback failure reporting.

- [ ] **Step 2: Run RED**

Run: `node --test test-imotion-directadmin-account-v1.js`
Expected: FAIL because `./imotion-directadmin-account-v1.js` does not exist.

- [ ] **Step 3: Commit RED test**

Commit only the test and docs on the isolated feature branch.

### Task 3: Minimal GREEN implementation

**Files:**
- Create: `imotion-directadmin-account-v1.js`
- Test: `test-imotion-directadmin-account-v1.js`

**Interfaces:**
- `buildBoundSpec(evidence) -> frozen spec`
- `preflightWithAdapter(spec, adapter) -> sanitized evidence`
- `applyWithAdapter(spec, adapter) -> sanitized result`
- Adapter methods: `revalidateTarget`, `listUsers`, `domainOwners`, `resolveCreateIp`, `createUser`, `showUserConfig`, `deleteUser`, `persistJournal`.

- [ ] **Step 1: Implement evidence validation and binding**

Require exact target `10.71.0.10`, non-empty fingerprint/version/admin identity, all required capabilities true, user `imotion` absent, and every fixed domain owner null/unowned. Freeze the resulting spec and expose no caller-overridable host/user/domain/API endpoint.

- [ ] **Step 2: Implement fail-closed pre-mutation revalidation**

Compare fresh target evidence to every bound identity/ownership field before any mutation method can be called.

- [ ] **Step 3: Implement one create transaction**

Generate the password inside the production adapter, acquire a fresh in-memory `da api-url`, resolve an allowed server IP, call only `CMD_API_ACCOUNT_USER` with fixed username/domain and `notify=no`, then verify with show-all-users and show-user-config.

- [ ] **Step 4: Implement journal-bound rollback**

Persist only secret-free journal fields. Delete `imotion` with `CMD_API_SELECT_USERS` only when the journal proves this invocation created the account and current readback still matches `imotion` + `imotion.ir`.

- [ ] **Step 5: Run GREEN contract**

Run: `node --test test-imotion-directadmin-account-v1.js`
Expected: PASS.

- [ ] **Step 6: Run syntax check**

Run: `node --check imotion-directadmin-account-v1.js`
Expected: exit 0.

- [ ] **Step 7: Commit implementation**

Commit implementation and any test refinements.

### Task 4: Production adapter and secret controls

**Files:**
- Modify: `imotion-directadmin-account-v1.js`
- Test: `test-imotion-directadmin-account-v1.js`

**Interfaces:**
- Production adapter executes only fixed root DirectAdmin commands and local API calls on `10.71.0.10` through the sanctioned remote-controller path.

- [ ] **Step 1: Add production command wrapper with redaction**

Allow only the exact commands needed for `da admin`, `da version`, `da api-url`, fixed API endpoints, service/2222 checks, and rollback. Reject any unexpected command construction.

- [ ] **Step 2: Prove API URL/password never escape**

Tests inspect results, journals, error strings, and captured logs for credential material and must remain green.

- [ ] **Step 3: Re-run full contract and syntax checks**

Expected: all PASS.

- [ ] **Step 4: Commit**

Commit production adapter hardening.

### Task 5: Generate exact production artifact from actual preflight

**Files:**
- Update generated constants in: `imotion-directadmin-account-v1.js`
- Test: `test-imotion-directadmin-account-v1.js`

**Interfaces:**
- Consumes: Task 1 actual preflight evidence.
- Produces: exact action source SHA-256 and bound precondition fingerprint.

- [ ] **Step 1: Bind actual fingerprint/admin/version/domain-owner preimage**

Generate the final immutable production artifact from Task 1 evidence; no placeholders or caller inputs remain.

- [ ] **Step 2: Run full tests and syntax check**

Expected: PASS.

- [ ] **Step 3: Compute source SHA-256**

Record the exact SHA in the bootstrap/registration artifact and verification tests.

- [ ] **Step 4: Commit and push**

Push the feature branch and verify remote branch HEAD equals local commit.

### Task 6: Fixed Host Actions registration/bootstrap

**Files:**
- Create: `bootstrap-host-actions-imotion-directadmin-account-v1.js`
- Create: `test-bootstrap-host-actions-imotion-directadmin-account-v1.js`

**Interfaces:**
- Consumes: exact action source SHA from Task 5.
- Produces: fixed action registration `imotion_directadmin_account_v1` classified Level-4/critical with no arbitrary runtime inputs.

- [ ] **Step 1: Write RED registration tests**

Require exact action name/SHA, Level-4 operation, fixed rollback reference, no broad path/command input, baseline SHA guards, atomic install, and rollback of control-plane registration changes on failure.

- [ ] **Step 2: Run RED**

Expected: FAIL before bootstrap exists.

- [ ] **Step 3: Implement minimal registration bootstrap**

Patch only exact Host Actions base/executor/policy/MCP anchors and install only the exact SHA-bound action helper.

- [ ] **Step 4: Run GREEN tests and syntax checks**

Expected: PASS.

- [ ] **Step 5: Commit/push and verify remote parity**

No force push.

- [ ] **Step 6: Promote through the existing sanctioned fixed installer-refresh transport**

Use only the existing typed SHA-bound promotion surface; no raw file write or policy downgrade. Verify runtime helper SHA equals the pushed Git artifact SHA.

### Task 7: Fresh pre-mutation revalidation and Level-4 gate

**Files:** none

**Interfaces:**
- Consumes: installed exact action SHA and fresh read-only preconditions.
- Produces: one pending Level-4 request for `imotion_directadmin_account_v1`.

- [ ] **Step 1: Re-run fresh preflight**

All bound evidence must still match immediately before request creation.

- [ ] **Step 2: Create exact Level-4 request**

Request must be bound to action `imotion_directadmin_account_v1`, exact installed action SHA, target `10.71.0.10`, user `imotion`, and primary domain `imotion.ir`.

- [ ] **Step 3: Stop before mutation and obtain literal**

Require exactly: `CONFIRM_LEVEL_4_CRITICAL`.

### Task 8: Apply, verify, rollback gate, closure

**Files:** none except secret-free runtime journal/result

**Interfaces:**
- Consumes: one-time Level-4 request from Task 7.
- Produces: verified DirectAdmin user/domain state and closure evidence.

- [ ] **Step 1: Apply once**

Consume the one-time approval and execute only the fixed action.

- [ ] **Step 2: Verify exact result**

Require exactly one `imotion` user, primary domain `imotion.ir`, expected creator/admin/IP, no ownership changes for other fixed iMotion domains, and no current-production runtime mutation.

- [ ] **Step 3: On any verification failure, execute guarded rollback**

Delete only the user proven created by this invocation and verify the preimage is restored. Surface rollback failure as critical; never claim success.

- [ ] **Step 4: Verify Git/runtime closure**

Runtime action SHA must equal pushed Git artifact SHA; remote HEAD must contain the exact artifact and tests.

- [ ] **Step 5: Declare DONE only after all closure checks pass**

Do not proceed to domain migration, database import, DNS, SSL, or production cutover in this action.