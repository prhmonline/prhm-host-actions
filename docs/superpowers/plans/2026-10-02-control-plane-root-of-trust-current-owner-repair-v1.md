# Control Plane Root-of-Trust Current-Owner Repair V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the normal Host Actions v2 installer/registration path by executing one content-addressed, zero-input Root-of-Trust bootstrap that runs the already-reviewed current-owner repair and then returns control to the normal approval-bound Host Actions flow.

**Architecture:** Implementation starts from the tested repair baseline `repair/control-plane-current-owner-bootstrap-v1` at `33a2b12c78a5bd294958d4c6e9d9b6a290b4d050`. A new standalone CommonJS artifact embeds the exact reviewed `control-plane-current-owner-bootstrap-repair-v1.js` bytes and SHA-256, independently verifies frozen live preimages, runs that helper once through a constrained one-shot systemd sandbox, verifies post-state, and leaves no daemon/listener behind. After the Root-of-Trust artifact succeeds, registration of the repaired current-owner action happens only through the existing normal `host_action_v2_installer_v1` approval path under a fresh Level-4 request; the Root-of-Trust artifact itself does not register arbitrary actions and does not install Solo Company Runtime.

**Tech Stack:** Node.js 20 CommonJS, `node:test`, `node:assert/strict`, `node:crypto`, `node:fs`, `node:child_process`, systemd one-shot sandboxing, SHA-256 content addressing, existing Host Actions v2 request/apply flow.

**Spec:** `docs/superpowers/specs/2026-10-02-control-plane-root-of-trust-current-owner-repair-v1-design.md`

## Global Constraints

- Root-of-Trust execution must remain independent of the currently broken Host Actions v2 installer/allowlist path.
- No runtime action name, path, command, service, URL, repository/ref, SHA, file content, environment override, credential, SQL, or arbitrary payload input is allowed.
- The only authorization input is the exact external `CONFIRM_LEVEL_4_CRITICAL` at the production invocation boundary; it is not passed into the artifact as a reusable token.
- All production target paths, owner preimages, helper identity, expected post-state hashes, services and rollback paths are compile-time constants after implementation-time discovery.
- Any live baseline drift before first mutation is a hard deny with zero mutation.
- The Root-of-Trust artifact must execute exactly the reviewed current-owner repair logic; it must not reimplement approval-policy/mediator mutation logic.
- No Company OS code/data, Solo Company runtime/data, business application tree, production database, DNS, SSL, payment, SMS, email, customer/order/ticket state or unrelated Host Action may be changed.
- No new generic root API, shell endpoint, command runner, file writer, socket, timer, cron or persistent listener may be created.
- Temporary execution artifacts must be removed after bounded evidence is persisted.
- A fresh production Level-4 approval is required for Root-of-Trust execution. A separate fresh Level-4 approval is required for the subsequent normal `host_action_v2_installer_v1` registration apply. Earlier approvals are not reused.
- Solo Company bootstrap/install remains a later separate Gate and is out of scope for this plan.

## Review Focus

1. **Live owner drift between review and execution:** one changed byte in any frozen owner/helper/preimage must deny before mutation; Task 1 pins this with drift tests.
2. **Helper identity or execution-result ambiguity:** wrong embedded helper SHA or malformed helper output must never become success; Task 2 verifies helper SHA and independent post-state evidence.
3. **Partial mutation / rollback correctness:** injected helper failure, post-write mismatch or service-health failure must restore exact preimages; Task 2 exercises each rollback path.
4. **Healthy services but broken registration path:** service health alone is insufficient; Task 4 requires the normal installer action to become usable and the target current-owner action to become requestable under the expected Level-4 policy.
5. **Replay/idempotency:** second Root-of-Trust execution after exact success must return `ALREADY_APPLIED` without rewrites, duplicate registration or additional restarts; Tasks 2 and 4 pin both layers.

---

## File Structure

Implementation branch/worktree must be created from exact repair baseline `33a2b12c78a5bd294958d4c6e9d9b6a290b4d050`, not from `main` and not from the documentation branch.

**Existing files reused unchanged:**
- `control-plane-current-owner-bootstrap-repair-v1.js` — reviewed repair logic and exact helper bytes to embed.
- `test-control-plane-current-owner-bootstrap-repair-v1.js` — regression contract for the existing repair.
- `bootstrap-host-actions-control-plane-current-owner-bootstrap-repair-v1.js` — reference registration plan only; not the Root-of-Trust executor.

**New implementation files:**
- `control-plane-root-of-trust-current-owner-repair-v1.js` — zero-input content-addressed Root-of-Trust executor.
- `test-control-plane-root-of-trust-current-owner-repair-v1.js` — TDD contract for preflight, helper execution, rollback, idempotency and cleanup.

**Documentation already approved:**
- `docs/superpowers/specs/2026-10-02-control-plane-root-of-trust-current-owner-repair-v1-design.md`
- `docs/superpowers/plans/2026-10-02-control-plane-root-of-trust-current-owner-repair-v1.md`

No legacy installer-refresh source is modified by this plan.

---

### Task 1: Build the zero-input Root-of-Trust preflight contract

**Files:**
- Create: `control-plane-root-of-trust-current-owner-repair-v1.js`
- Create: `test-control-plane-root-of-trust-current-owner-repair-v1.js`
- Read only: `control-plane-current-owner-bootstrap-repair-v1.js`
- Read only: `test-control-plane-current-owner-bootstrap-repair-v1.js`

**Interfaces:**
- Consumes: exact repair helper bytes from `control-plane-current-owner-bootstrap-repair-v1.js` at implementation baseline `33a2b12c78a5bd294958d4c6e9d9b6a290b4d050`.
- Produces: `manifest()`, `preflight()`, `apply()`, `main(argv)`; production entrypoints accept no caller-controlled operational values. Test-only dependency injection remains inside `__test` and is not reachable from CLI arguments.

- [ ] **Step 1: Create an isolated implementation worktree from the exact repair baseline**

Use `superpowers:using-git-worktrees`. Create branch `feat/control-plane-root-of-trust-current-owner-repair-v1` from commit `33a2b12c78a5bd294958d4c6e9d9b6a290b4d050` and verify:

```bash
git rev-parse HEAD
git status --short --branch
```

Expected: HEAD exactly `33a2b12c78a5bd294958d4c6e9d9b6a290b4d050`, clean worktree.

- [ ] **Step 2: Re-run the existing current-owner repair regression before new code**

Run:

```bash
node --test test-control-plane-current-owner-bootstrap-repair-v1.js
```

Expected: `8` tests PASS. If not, stop; do not build the Root-of-Trust wrapper on a changed repair baseline.

- [ ] **Step 3: Write failing manifest/preflight tests**

Add tests named:

- `manifest is zero-input and binds the exact current-owner repair helper`
- `preflight denies one-byte owner drift before mutation`
- `preflight denies helper SHA mismatch before mutation`
- `preflight denies symlink target`
- `preflight denies unexpected CLI argument`
- `preflight ignores no environment override because none is read`
- `preflight returns ALREADY_APPLIED when exact desired post-state already exists`

Assertions must pin:

- action: `control_plane_root_of_trust_current_owner_repair_v1`;
- target repair: `control_plane_current_owner_bootstrap_repair_v1`;
- `zero_input === true`;
- `arbitrary_command === false`;
- `arbitrary_path === false`;
- `database_mutation === false`;
- fixed backup root: `/var/backups/prhm-root-of-trust-current-owner-repair-v1`;
- fixed transient execution root under `/run`;
- embedded helper SHA equals SHA-256 of the exact reviewed helper bytes;
- owner SHA values are frozen only after fresh implementation-time read of all repair-owned production files.

- [ ] **Step 4: Run the new test file and verify RED**

Run:

```bash
node --test test-control-plane-root-of-trust-current-owner-repair-v1.js
```

Expected: FAIL because the new module/functions do not exist yet.

- [ ] **Step 5: Implement minimal manifest/preflight**

In `control-plane-root-of-trust-current-owner-repair-v1.js`, provide:

```js
function manifest()
function preflight()
function apply()
function main(argv = process.argv.slice(2))
```

Implementation rules:

- embed the exact helper bytes or an immutable equivalent representation plus its SHA-256;
- freeze all implementation-time owner/preimage/post-state hashes as constants;
- require regular-file + non-symlink + realpath + owner/mode checks for every target;
- reject any CLI argument in production execution; normal invocation is zero arguments;
- do not read environment values to choose behavior;
- calculate the exact expected post-state installer SHA from the reviewed helper fixture before production execution;
- return bounded evidence only; no file contents, environment values or secrets.

- [ ] **Step 6: Run focused tests and syntax check**

Run:

```bash
node --check control-plane-root-of-trust-current-owner-repair-v1.js
node --test test-control-plane-root-of-trust-current-owner-repair-v1.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add control-plane-root-of-trust-current-owner-repair-v1.js test-control-plane-root-of-trust-current-owner-repair-v1.js
git commit -m "feat(control-plane): add root-of-trust repair preflight"
```

---

### Task 2: Add one-shot helper execution, independent verification and rollback

**Files:**
- Modify: `control-plane-root-of-trust-current-owner-repair-v1.js`
- Modify: `test-control-plane-root-of-trust-current-owner-repair-v1.js`
- Read only: `control-plane-current-owner-bootstrap-repair-v1.js`

**Interfaces:**
- Consumes: Task 1 `manifest()` and frozen preflight constants.
- Produces: `apply()` with terminal result states `SUCCEEDED`, `ALREADY_APPLIED`, `DENIED_BASELINE_DRIFT`, `FAILED_NO_MUTATION`, `FAILED_ROLLED_BACK`, `FAILED_ROLLBACK_INCOMPLETE`.

- [ ] **Step 1: Add failing transaction tests**

Add tests named:

- `apply executes only the embedded fixed repair helper`
- `helper failure before mutation reports FAILED_NO_MUTATION`
- `malformed helper output requires independent post-state proof`
- `post-write SHA mismatch restores exact preimage`
- `service health failure restores exact preimage`
- `rollback SHA mismatch reports FAILED_ROLLBACK_INCOMPLETE`
- `successful second apply is ALREADY_APPLIED without rewrite or restart`
- `temporary helper and result artifacts are removed after terminal result`

Use a fixture API that substitutes filesystem/process/service operations only in tests. Do not add production CLI inputs to make testing easier.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test test-control-plane-root-of-trust-current-owner-repair-v1.js
```

Expected: the new transaction tests FAIL.

- [ ] **Step 3: Implement the constrained helper execution path**

`apply()` must:

1. call preflight immediately before mutation;
2. create exact byte backups under `/var/backups/prhm-root-of-trust-current-owner-repair-v1/<invocation-id>/` with restrictive permissions;
3. materialize only the embedded reviewed helper to `/run/prhm-current-owner-bootstrap-repair-v1-<pid>.js` using create-exclusive semantics;
4. fsync, chmod and verify helper SHA before execution;
5. execute exactly `/usr/local/bin/prhm-node <fixed-temp-helper> apply` through a one-shot systemd sandbox with fixed properties and fixed read/write paths;
6. parse bounded helper output if valid;
7. independently verify the expected installer post-state SHA, unchanged owner SHAs and required service health regardless of helper output;
8. treat malformed output as success only when all independently verified post-state assertions prove the exact approved mutation occurred; otherwise rollback/fail;
9. restore exact preimages and verify restored hashes on any post-mutation failure;
10. remove `/run` artifacts in `finally`;
11. never invoke `host_action_v2_request`, `host_action_v2_apply`, Solo Company installer, database tools or arbitrary shell logic from this artifact.

- [ ] **Step 4: Run Task 2 tests and existing repair regression**

```bash
node --check control-plane-root-of-trust-current-owner-repair-v1.js
node --test test-control-plane-root-of-trust-current-owner-repair-v1.js
node --test test-control-plane-current-owner-bootstrap-repair-v1.js
```

Expected: all PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add control-plane-root-of-trust-current-owner-repair-v1.js test-control-plane-root-of-trust-current-owner-repair-v1.js
git commit -m "feat(control-plane): add root-of-trust repair transaction"
```

---

### Task 3: Freeze the release artifact and perform a no-mutation production preflight

**Files:**
- No source changes unless fresh baseline discovery proves a frozen constant in Task 1 is stale before the artifact has been approved.
- Runtime staging target: `/run/prhm-root-of-trust-current-owner-repair-v1.js` only during the production Gate.

**Interfaces:**
- Consumes: Task 2 executable artifact and test suite.
- Produces: reviewed artifact SHA-256, exact production preimage manifest, dry preflight evidence; no production mutation.

- [ ] **Step 1: Run the complete bounded repository verification**

Run from the isolated worktree:

```bash
node --check control-plane-root-of-trust-current-owner-repair-v1.js
node --test test-control-plane-current-owner-bootstrap-repair-v1.js test-control-plane-root-of-trust-current-owner-repair-v1.js
git status --short
```

Expected: all tests PASS and only intentional committed changes exist.

- [ ] **Step 2: Compute and record immutable artifact SHA-256**

Compute SHA-256 of `control-plane-root-of-trust-current-owner-repair-v1.js` and of embedded helper bytes. Record them in release evidence; do not accept runtime SHA input.

- [ ] **Step 3: Fresh read-only production discovery**

Read only the fixed targets named by the artifact and verify:

- regular file / non-symlink / realpath;
- owner/group/mode;
- exact preimage SHA-256;
- exact current-owner helper/installer identities;
- required services exist;
- no conflicting already-applied registration exists.

If any value differs from the reviewed frozen manifest, stop and return to Task 1; do not patch constants on the server.

- [ ] **Step 4: Stage exact artifact bytes through the existing authorized out-of-band host console**

Use the already-authorized host-level console channel only as an operator transport. It must stage exactly the reviewed artifact bytes to `/run/prhm-root-of-trust-current-owner-repair-v1.js`, mode `0700`, verify SHA-256, and execute no mutation yet.

Do not create a new generic root listener/API and do not route this stage through Agent API/MCP/Host Actions v2.

- [ ] **Step 5: Run artifact preflight with zero arguments**

Execute the staged artifact in preflight mode only if the implementation exposes preflight as the zero-input default; otherwise invoke the module's fixed preflight entrypoint through a fixed reviewed wrapper created in Task 1. No arbitrary arguments are allowed.

Expected bounded evidence:

- baseline verified;
- helper identity verified;
- `production_mutation=false`;
- either `would_change=true` or exact `ALREADY_APPLIED`;
- no application/database mutation.

- [ ] **Step 6: Stop for a fresh production Level-4 approval**

Do not execute Root-of-Trust mutation until the user explicitly supplies a fresh:

`CONFIRM_LEVEL_4_CRITICAL`

This approval is only for the Root-of-Trust artifact execution in Task 4.

---

### Task 4: Execute Root-of-Trust repair and restore the normal Host Actions v2 registration path

**Files:**
- Production mutation by the fixed Root-of-Trust artifact only.
- Existing repaired target: `/opt/prhm-agent-selfmaint-exec/actions/host-action-v2-installer-v1.js` as governed by the embedded current-owner helper.

**Interfaces:**
- Consumes: fresh Task 3 Level-4 approval and exact staged artifact SHA.
- Produces: repaired installer/helper post-state, healthy control-plane services, then a normal Host Actions v2 registration request/apply path.

- [ ] **Step 1: Re-check staged artifact SHA and all preconditions immediately before apply**

If any SHA, ownership, mode, service identity or helper identity changed after Task 3, abort with zero mutation.

- [ ] **Step 2: Execute the Root-of-Trust artifact exactly once**

Use the independent out-of-band host console to execute only the reviewed zero-input artifact. Do not pass paths, commands, SHAs or action names.

Expected terminal state: `SUCCEEDED` or exact `ALREADY_APPLIED`.

On any other result, stop. If result is `FAILED_ROLLED_BACK`, verify restored hashes before proceeding. If `FAILED_ROLLBACK_INCOMPLETE`, stop all work and report a critical incident.

- [ ] **Step 3: Verify post-repair hashes and service health**

Read-only verify:

- installer post-state SHA equals the reviewed expected SHA;
- frozen owner files remain on their approved hashes;
- required control-plane services are active/healthy;
- no business application/database mutation occurred;
- no `/run` execution artifact remains.

- [ ] **Step 4: Create a fresh normal Host Actions v2 request for `host_action_v2_installer_v1`**

This is intentionally outside the Root-of-Trust artifact. Verify the request is classified Level-4/critical, one-time and expiring.

- [ ] **Step 5: Stop for a second fresh Level-4 approval**

The user must explicitly supply a new `CONFIRM_LEVEL_4_CRITICAL` for the normal Host Actions v2 installer registration apply. Do not reuse Task 4 Step 2 approval.

- [ ] **Step 6: Apply only `host_action_v2_installer_v1` through Host Actions v2**

Consume the fresh request using the existing approval-bound apply surface. This step may register the fixed current-owner repair action only according to the repaired installer contract. It must not execute the current-owner repair again and must not install Solo Company Runtime.

- [ ] **Step 7: Verify the target current-owner action is now requestable**

Create a fresh bounded request for:

`control_plane_current_owner_bootstrap_repair_v1`

Verify only:

- no `host_action_v2_not_allowed`;
- Level-4 / critical classification;
- one-time-use and expiry present;
- fixed action binding;
- no arbitrary arguments.

Do **not** apply this verification request if the desired installer post-state is already exact; its purpose is proof that the normal approval path is restored.

- [ ] **Step 8: Verify idempotency**

A second Root-of-Trust preflight must report `ALREADY_APPLIED`; a repeated registration install must not create duplicate action/policy entries. Do not consume unnecessary extra Level-4 requests to prove idempotency if read-only state proves it.

---

### Task 5: Retire temporary recovery state and hand back to the Solo Company rollout

**Files:**
- Remove transient `/run/prhm-root-of-trust-current-owner-repair-v1.js` if still present.
- Do not remove immutable repository source/audit history.

**Interfaces:**
- Consumes: Task 4 verified normal Host Actions v2 path.
- Produces: clean recovery boundary and explicit checkpoint for later Solo Company install.

- [ ] **Step 1: Cleanup transient recovery artifacts**

Verify no recovery-only listener, service, socket, timer or cron exists. Delete only the transient `/run` artifact/result files defined by this plan. Preserve backup/evidence required for rollback/audit.

- [ ] **Step 2: Final read-only health check**

Verify:

- Control Plane approval/self-maintenance services healthy;
- Host Actions v2 can request the fixed current-owner action;
- Company OS existing production route remains healthy;
- no Solo Company Runtime unit was created by this plan;
- no production DB/business application mutation occurred.

- [ ] **Step 3: Run repository verification before completion claim**

Use `superpowers:verification-before-completion` and run:

```bash
node --check control-plane-root-of-trust-current-owner-repair-v1.js
node --test test-control-plane-current-owner-bootstrap-repair-v1.js test-control-plane-root-of-trust-current-owner-repair-v1.js
git status --short --branch
```

Expected: all PASS, feature worktree clean.

- [ ] **Step 4: Commit any final test-only adjustment, if one was required before production**

No production-discovered code change may be committed after execution without rerunning Task 3 and obtaining a new artifact SHA / production approval. If no source changed, no commit is needed.

- [ ] **Step 5: Stop before Solo Company installation**

Report recovery Gate complete and provide the next checkpoint only:

`normal Host Actions v2 path restored; Solo Company bootstrap/install remains separately approval-gated.`

Do not create or start `prhm-solo-company-runtime.service` in this plan.
