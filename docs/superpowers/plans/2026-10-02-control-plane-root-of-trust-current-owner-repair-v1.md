# Control Plane Root-of-Trust Current-Owner Repair V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break the current Control Plane bootstrap loop with one content-addressed, zero-input Root-of-Trust artifact that installs exactly the fixed current-owner Host Actions registration, executes the already-reviewed current-owner repair, verifies the normal approval path, and then retires without installing Solo Company Runtime.

**Architecture:** Implementation starts from the tested repair baseline `repair/control-plane-current-owner-bootstrap-v1` at `33a2b12c78a5bd294958d4c6e9d9b6a290b4d050`. The new artifact follows the proven `bootstrap-prhm-root-of-trust-fixed-seed-v1.js` pattern, but is scoped only to `control_plane_current_owner_bootstrap_repair_v1`: it embeds the exact reviewed repair helper bytes, installs that helper at one fixed action path, adds only the fixed base/executor/policy registration required for that action, executes the helper once, and verifies exact post-state. It does not reuse `host_action_v2_installer_v1` because that installer is target-specific to another action; no generic installer or shell path is introduced.

**Tech Stack:** Node.js 20 CommonJS, `node:test`, `node:assert/strict`, `node:crypto`, `node:fs`, `node:child_process`, systemd one-shot sandboxing, SHA-256 content addressing, existing Host Actions v2 request/apply policy model.

**Spec:** `docs/superpowers/specs/2026-10-02-control-plane-root-of-trust-current-owner-repair-v1-design.md`

## Global Constraints

- Root-of-Trust execution must remain independent of the broken Host Actions v2 allowlist/installer chain.
- Runtime inputs are empty. No action name, path, command, service, URL, repository/ref, SHA, file content, environment override, credential, SQL or arbitrary payload may be accepted.
- The only authorization input is the exact external `CONFIRM_LEVEL_4_CRITICAL` at the production invocation boundary; it is not passed into the artifact as a reusable token.
- Production target paths, owner preimages, helper identity, expected post-state hashes, registration anchors, services and rollback paths are compile-time constants after fresh implementation-time discovery.
- Any baseline drift before first mutation is a hard deny with zero mutation.
- The existing `control-plane-current-owner-bootstrap-repair-v1.js` remains the single implementation of the current-owner repair logic; the Root-of-Trust artifact must execute it, not copy its installer-repair transformation.
- Registration logic may add only the single fixed action `control_plane_current_owner_bootstrap_repair_v1` and operation `host_action.control_plane_current_owner_bootstrap_repair_v1`.
- `host_action_v2_installer_v1` must not be used for this registration because its current target is unrelated.
- If the live MCP request schema already accepts arbitrary action strings and the rejection is backend `host_action_v2_not_allowed`, MCP source must remain unchanged. Patch MCP only if fresh read-only discovery proves a fixed enum blocks this exact action.
- No Company OS code/data, Solo Company runtime/data, business application tree, production database, DNS, SSL, payment, SMS, email, customer/order/ticket state or unrelated Host Action may change.
- No new generic root API, shell endpoint, command runner, file writer, socket, timer, cron or persistent listener may be created.
- Temporary `/run` execution artifacts are deleted after terminal evidence is persisted.
- A fresh production `CONFIRM_LEVEL_4_CRITICAL` is required after plan execution reaches the Production Gate. Earlier confirmations are not reused.
- Solo Company bootstrap/install is a later separate Gate and out of scope.

## Review Focus

1. **Live drift after review:** one changed byte in any frozen registration/helper/installer preimage must deny before mutation; Task 1 pins this.
2. **Wrong or conflicting registration:** an existing partial/conflicting action entry must deny rather than merge heuristically; Task 1 tests exact/absent/conflict states.
3. **Helper execution ambiguity:** wrong helper SHA or malformed helper output must not become success unless independent exact post-state proof exists; Task 2 pins this.
4. **Cross-file rollback:** failure after registration but before/after helper mutation must restore every changed registration/helper/installer preimage and service state; Task 2 injects failures at both boundaries.
5. **Replay/idempotency:** second execution on the exact desired state must return `ALREADY_APPLIED` with no rewrites, duplicate entries or extra restarts; Tasks 2 and 4 verify this.

---

## File Structure

Implementation work begins from exact repair commit `33a2b12c78a5bd294958d4c6e9d9b6a290b4d050`, not `main` and not the documentation branch.

**Existing files reused unchanged:**
- `control-plane-current-owner-bootstrap-repair-v1.js` — reviewed repair helper; exact bytes are embedded in the Root-of-Trust artifact and also installed at a fixed action path.
- `test-control-plane-current-owner-bootstrap-repair-v1.js` — regression contract for that helper.
- `bootstrap-host-actions-control-plane-current-owner-bootstrap-repair-v1.js` — fixed action/operation/risk registration plan.
- `bootstrap-prhm-root-of-trust-fixed-seed-v1.js` — reference implementation for out-of-band fixed registration/rollback mechanics only; historical action names/anchors/hashes must not be copied blindly.
- `test-prhm-root-of-trust-fixed-seed-v1.js` — reference test pattern.

**New implementation files:**
- `control-plane-root-of-trust-current-owner-repair-v1.js` — zero-input Root-of-Trust registration + helper execution transaction.
- `test-control-plane-root-of-trust-current-owner-repair-v1.js` — TDD contract.

No legacy installer-refresh source is modified by this plan.

---

### Task 1: Build the fixed registration and preflight contract

**Files:**
- Create: `control-plane-root-of-trust-current-owner-repair-v1.js`
- Create: `test-control-plane-root-of-trust-current-owner-repair-v1.js`
- Read only: `control-plane-current-owner-bootstrap-repair-v1.js`
- Read only: `bootstrap-host-actions-control-plane-current-owner-bootstrap-repair-v1.js`
- Read only: `bootstrap-prhm-root-of-trust-fixed-seed-v1.js`

**Interfaces:**
- Consumes: fixed registration identity from `registrationPlan()` and exact repair helper bytes from repair commit `33a2b12c78a5bd294958d4c6e9d9b6a290b4d050`.
- Produces: `manifest()`, `buildCandidates(snapshot)`, `preflight(adapter)`, `apply(adapter)`, `main(argv)`; only `main([])` is a valid production CLI invocation. Test adapters are module-internal/test-only, never CLI inputs.

- [ ] **Step 1: Create isolated implementation worktree**

Use `superpowers:using-git-worktrees`; create `feat/control-plane-root-of-trust-current-owner-repair-v1` from exact commit `33a2b12c78a5bd294958d4c6e9d9b6a290b4d050`.

Run:

```bash
git rev-parse HEAD
git status --short --branch
node --test test-control-plane-current-owner-bootstrap-repair-v1.js
```

Expected: exact HEAD, clean worktree, existing repair tests `8/8 PASS`.

- [ ] **Step 2: Perform fresh read-only registration-layer discovery before writing tests**

Identify the exact current production paths and anchors for:

- base Host Actions registry/spec;
- executor registry/dispatcher;
- approval policy operation + typed scope;
- MCP schema only if it actually hard-codes an action enum;
- fixed helper install path `/opt/prhm-agent-selfmaint-exec/actions/control-plane-current-owner-bootstrap-repair-v1.js`;
- installer target modified by the embedded helper.

Freeze exact SHA-256, uid/gid/mode, realpath and service ownership. Confirm `host_action_v2_request` accepts the action string at schema level and the current rejection is backend allowlist; if so, record `mcp_mutation=false` in the manifest.

- [ ] **Step 3: Write failing registration/preflight tests**

Add tests named:

- `manifest is zero-input and binds only current-owner repair action`
- `registration plan matches fixed action operation level and helper`
- `absent exact registration builds deterministic candidates`
- `already exact registration is ALREADY_APPLIED candidate state`
- `partial or conflicting registration is denied`
- `one-byte baseline drift is denied before mutation`
- `symlink or wrong realpath is denied`
- `wrong owner or mode is denied`
- `repair helper SHA mismatch is denied`
- `unexpected CLI argument is denied`
- `MCP remains unchanged when schema is already open to fixed action string`

Pin exact identity:

- action `control_plane_current_owner_bootstrap_repair_v1`;
- operation `host_action.control_plane_current_owner_bootstrap_repair_v1`;
- Level `4`, risk `critical`;
- project `control_plane`, environment `production`, principal `mohammad`, role `mcp-operator`;
- helper fixed path above;
- backup root `/var/backups/prhm-root-of-trust-current-owner-repair-v1`;
- no arbitrary path/command/input surface;
- `database_mutation=false`.

- [ ] **Step 4: Run new tests and verify RED**

```bash
node --test test-control-plane-root-of-trust-current-owner-repair-v1.js
```

Expected: FAIL because the new module does not yet exist.

- [ ] **Step 5: Implement minimal deterministic candidate builder and preflight**

Implement only enough to satisfy Task 1 tests:

```js
function manifest()
function buildCandidates(snapshot)
async function preflight(adapter)
async function apply(adapter)
function main(argv = process.argv.slice(2))
```

Rules:

- use current live anchors discovered in Step 2, not historical seed anchors;
- install/register only the one fixed current-owner action;
- executor apply block may invoke only the fixed helper path and validate helper SHA + bounded result contract;
- policy adds exactly one Level-4 operation and one `host_action_v2_apply` typed scope if absent;
- reject partial/conflicting mentions;
- embed the exact helper bytes and SHA-256;
- freeze expected installer post-state SHA produced by the reviewed helper fixture;
- direct execution with any CLI argument is rejected; zero args are the only valid production invocation.

- [ ] **Step 6: Verify Task 1 GREEN**

```bash
node --check control-plane-root-of-trust-current-owner-repair-v1.js
node --test test-control-plane-root-of-trust-current-owner-repair-v1.js
node --test test-control-plane-current-owner-bootstrap-repair-v1.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add control-plane-root-of-trust-current-owner-repair-v1.js test-control-plane-root-of-trust-current-owner-repair-v1.js
git commit -m "feat(control-plane): add current-owner root-of-trust preflight"
```

---

### Task 2: Implement atomic registration + exact helper execution + rollback

**Files:**
- Modify: `control-plane-root-of-trust-current-owner-repair-v1.js`
- Modify: `test-control-plane-root-of-trust-current-owner-repair-v1.js`

**Interfaces:**
- Consumes: Task 1 deterministic candidates and frozen helper/post-state hashes.
- Produces terminal results: `SUCCEEDED`, `ALREADY_APPLIED`, `DENIED_BASELINE_DRIFT`, `FAILED_NO_MUTATION`, `FAILED_ROLLED_BACK`, `FAILED_ROLLBACK_INCOMPLETE`.

- [ ] **Step 1: Add failing transaction tests**

Add tests:

- `apply installs helper and registration before invoking repair`
- `registration post-write SHA mismatch rolls everything back`
- `service restart or health failure rolls everything back`
- `helper failure after registration restores registration and installer preimage`
- `malformed helper output requires independent exact post-state proof`
- `installer post-state mismatch rolls everything back`
- `rollback SHA mismatch reports FAILED_ROLLBACK_INCOMPLETE`
- `successful second apply returns ALREADY_APPLIED without write or restart`
- `temporary run artifacts are removed after success and failure`
- `no unrelated registration entry changes`

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test test-control-plane-root-of-trust-current-owner-repair-v1.js
```

Expected: new transaction tests FAIL.

- [ ] **Step 3: Implement the all-or-nothing transaction**

`apply(adapter)` must:

1. call `preflight(adapter)` immediately before mutation;
2. if exact desired registration + helper + installer post-state already exists, return `ALREADY_APPLIED` with no restart;
3. create byte-exact restrictive backups for every file that may change: registration layers, installed helper path, and installer target;
4. stage registration/helper candidates on the same filesystem, fsync, syntax/JSON validate, then atomically rename;
5. verify installed SHA for every written file before service restart;
6. restart only services owned by changed registration layers, then health-check them with bounded retries;
7. execute exactly the installed current-owner helper with argument `apply` inside a one-shot constrained systemd sandbox; no caller-controlled command/path/env;
8. parse helper output when valid, but independently verify the exact installer post-state SHA and unchanged owner hashes regardless of output;
9. verify the fixed registration remains exact after helper execution;
10. on any failure after first mutation, restore all registration/helper/installer preimages, restart only required services, verify restored hashes and health;
11. delete `/run` helper/result artifacts in `finally`;
12. never invoke Solo Company installer, DB operations or business application actions.

- [ ] **Step 4: Verify Task 2 GREEN and regression**

```bash
node --check control-plane-root-of-trust-current-owner-repair-v1.js
node --test test-control-plane-root-of-trust-current-owner-repair-v1.js
node --test test-control-plane-current-owner-bootstrap-repair-v1.js
```

Expected: all PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add control-plane-root-of-trust-current-owner-repair-v1.js test-control-plane-root-of-trust-current-owner-repair-v1.js
git commit -m "feat(control-plane): add atomic root-of-trust recovery transaction"
```

---

### Task 3: Freeze the reviewed artifact and prove production parity without mutation

**Files:**
- No production source mutation.
- Temporary production stage path only: `/run/prhm-root-of-trust-current-owner-repair-v1.js`.

**Interfaces:**
- Consumes: Task 2 artifact.
- Produces: immutable artifact SHA-256, exact production baseline parity evidence, clean Production Gate.

- [ ] **Step 1: Run bounded repository verification**

```bash
node --check control-plane-root-of-trust-current-owner-repair-v1.js
node --test test-control-plane-current-owner-bootstrap-repair-v1.js test-control-plane-root-of-trust-current-owner-repair-v1.js
git status --short --branch
```

Expected: PASS and clean feature worktree.

- [ ] **Step 2: Compute immutable artifact/helper SHA-256**

Record SHA-256 of the Root-of-Trust artifact and embedded helper bytes in release evidence. No runtime SHA input is allowed.

- [ ] **Step 3: Fresh read-only production parity check**

Re-read every frozen path and prove exact SHA/uid/gid/mode/realpath parity with `manifest()`. Also prove:

- no conflicting current-owner registration exists;
- MCP mutation is still unnecessary if manifest says `mcp_mutation=false`;
- installer preimage is exactly the reviewed expected preimage;
- required services are currently healthy.

Any mismatch returns to Task 1; never patch constants directly on Production.

- [ ] **Step 4: Stage exact artifact through the existing authorized out-of-band host console**

Use the pre-existing operator console only as transport. Write exactly the reviewed artifact bytes to `/run/prhm-root-of-trust-current-owner-repair-v1.js`, mode `0700`, and verify SHA-256. Do not execute it yet. Do not create any listener/API/service.

- [ ] **Step 5: Stop for fresh Production Level-4 approval**

Require a new explicit:

`CONFIRM_LEVEL_4_CRITICAL`

This approval applies only to Task 4 execution of the exact staged artifact SHA.

---

### Task 4: Execute the fixed Root-of-Trust recovery and verify Host Actions v2

**Files:**
- Production mutations only to the exact manifest targets and installer target controlled by the reviewed helper.

**Interfaces:**
- Consumes: Task 3 exact artifact SHA + fresh Level-4 confirmation.
- Produces: current-owner action registered, current-owner repair applied, healthy control plane, normal Host Actions v2 request path restored.

- [ ] **Step 1: Revalidate all hashes immediately before execution**

If staged artifact SHA or any production preimage differs from Task 3 evidence, abort with zero mutation.

- [ ] **Step 2: Execute exactly the zero-input Root-of-Trust artifact once**

Use the independent out-of-band operator channel to run only:

`/run/prhm-root-of-trust-current-owner-repair-v1.js`

with no arguments or environment-driven behavior.

Accept only terminal `SUCCEEDED` or exact `ALREADY_APPLIED`.

On `FAILED_ROLLED_BACK`, verify restored hashes and stop. On `FAILED_ROLLBACK_INCOMPLETE`, stop all work and report a critical incident.

- [ ] **Step 3: Read-only verify exact post-state**

Verify:

- fixed helper installed at expected SHA;
- registration layers equal expected post-state hashes;
- installer target equals expected repaired SHA;
- required services active/healthy;
- no duplicate operation/scope/dispatcher registration;
- no business application/database mutation;
- no recovery-only service/listener exists.

- [ ] **Step 4: Verify normal Host Actions v2 path with a fresh bounded request**

Create a fresh request for:

`control_plane_current_owner_bootstrap_repair_v1`

Verify:

- it is no longer rejected as `host_action_v2_not_allowed`;
- level `4`, risk `critical`;
- fixed action/operation binding;
- one-time-use + expiry;
- no arbitrary arguments.

Do **not** apply this verification request: the Root-of-Trust artifact already executed the exact repair helper. This request proves the normal future approval path is restored.

- [ ] **Step 5: Verify idempotency without a second mutation**

Use read-only state + fixture evidence to prove a second execution would return `ALREADY_APPLIED`. Do not consume another critical request merely to demonstrate replay behavior.

---

### Task 5: Cleanup, verification-before-completion, and Solo Company handoff

**Files:**
- Remove only transient `/run/prhm-root-of-trust-current-owner-repair-v1.js` and temporary result files.
- Preserve restrictive backups/evidence for audit/rollback.

**Interfaces:**
- Consumes: Task 4 verified recovery.
- Produces: clean Control Plane recovery checkpoint; Solo Company remains uninstalled.

- [ ] **Step 1: Cleanup transient recovery artifacts**

Delete only the fixed `/run` artifacts. Verify no timer/cron/socket/listener/service was added solely for recovery.

- [ ] **Step 2: Final read-only health checks**

Verify:

- approval/self-maintenance/executor services healthy;
- current-owner Host Action requestable;
- Company OS existing production route healthy;
- `prhm-solo-company-runtime.service` was not created/started by this plan;
- no production DB/business app mutation occurred.

- [ ] **Step 3: Run `superpowers:verification-before-completion`**

```bash
node --check control-plane-root-of-trust-current-owner-repair-v1.js
node --test test-control-plane-current-owner-bootstrap-repair-v1.js test-control-plane-root-of-trust-current-owner-repair-v1.js
git status --short --branch
```

Expected: all PASS and clean feature branch.

- [ ] **Step 4: Stop before Solo Company install**

Final checkpoint:

`Root-of-Trust recovery GREEN; normal Host Actions v2 current-owner path restored; Solo Company bootstrap/install remains a separate approval-gated operation.`

Do not create/start Solo Company Runtime in this plan.
