# Control Plane Root Scripts Typed Staging Capability V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and test an immutable candidate replacement for the existing MCP `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js` as `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`; it stages exactly two immutable Root-of-Trust transport artifacts, reports bounded metadata, and executes only the fixed registration bootstrap `--preflight-only` path.

**Architecture:** Modify only the existing MCP safe-files source plus focused tests; do not create a new privileged helper or generic writer. The two artifact byte sequences are deterministically embedded, reconstructed and SHA-verified, while staging mutation is gated by Approval Center validation/consume and a fresh Level-4 confirmation. Public Blue/Green/router exposure and any later Root-of-Trust `--apply` remain separate governed gates.

**Tech Stack:** Node.js ESM, built-in `fs`, `path`, `crypto`, `zlib`, `child_process`, MCP tool registration, existing self-maintenance and Approval Center contracts.

**Spec:** `docs/superpowers/specs/2026-08-21-control-plane-root-scripts-typed-staging-capability-v1-design.md`

## Candidate artifact boundary

Tasks 1-6 operate only on `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js` plus repository tests/docs. The live MCP file `/home/agent/ssh-mcp-server/src/plugins/safeFiles.js` is read-only baseline evidence until Task 7, which is separately gated and not authorized by this execution.

## Global Constraints

- Existing live MCP file to replace later: `/home/agent/ssh-mcp-server/candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`; freshly reviewed live evidence: 20090 bytes, SHA-256 `9f291891673806e34d2681ba7b8227ddd4470f73cec12f69a7c3e9035808caa2`.
- Development candidate path in this repository: `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`. Tasks 1-6 modify only this candidate and tests/docs, never the live MCP file.
- Self-maintenance replacement payload ceiling: `120000` bytes; final candidate `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js` MUST be `<=120000` bytes or implementation stops fail-closed.
- Immutable source commit: `51027bc81f16840580b3ed5ca09d6c42f78dc044`.
- Transport artifact: `control-plane-typed-bootstrap-transport-v1.js`, 72854 bytes, SHA-256 `049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335`.
- Registration bootstrap artifact: `bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js`, 109634 bytes, SHA-256 `d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e`.
- Embedded package id: `deployhq_control_adapter_node1_recreate_v1`; manifest SHA-256 `aa3e87db8630b1fac0d8db1a6863a733563763bc39b8677f8af2a7e6088b7728`.
- Fixed staging root: `/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/`.
- Stage mutation operation identity: `host_action.control_plane_root_scripts_stage_transport_v1`.
- Stage tool accepts no caller-controlled path/content/command/URL/repository/SHA fields.
- `--apply` must be structurally unreachable from this capability.
- Do not change MCP sandbox settings, `ProtectHome`, `ProtectSystem`, service units, DeployHQ, node1, Honartik, iMotion, databases, applications, redirects, canonicals or SEO state.
- Capability source installation, MCP rolling exposure, artifact staging, fixed preflight execution and later Root-of-Trust apply are separate gates; confirmations are never reused.

---

### Task 1: Deterministic Artifact Packaging and 120KB Feasibility Gate

**Files:**
- Modify later: `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`
- Create: `test-control-plane-root-scripts-typed-staging-capability-v1.js`
- Read: immutable artifacts from commit `51027bc81f16840580b3ed5ca09d6c42f78dc044`

**Interfaces:**
- Produces constants `ROOT_TRUST_STAGE_ROOT`, `ROOT_TRUST_ARTIFACTS`, and deterministic reconstruction helper `reconstructRootTrustArtifact(id)`.
- Produces a measured final candidate byte count before any production request is created.

- [ ] **Step 1: Add failing packaging identity tests**

Add tests asserting both reconstructed buffers have exact byte lengths and SHA-256 values from Global Constraints, and that unknown artifact ids throw `root_trust_artifact_unknown`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:
```bash
node test-control-plane-root-scripts-typed-staging-capability-v1.js
```
Expected: FAIL because packaging constants/helpers are absent.

- [ ] **Step 3: Add deterministic compressed/base64 constants and reconstruction helper**

Use only built-in deterministic decoding/decompression. The helper must validate reconstructed length and SHA-256 before returning bytes. Caller input may select only an internal fixed enum value used by tests/internal code; no MCP schema exposes artifact id.

- [ ] **Step 4: Verify reconstructed bytes exactly match immutable source artifacts**

Run the focused test. Expected: PASS for exact size/SHA and negative unknown-id case.

- [ ] **Step 5: Measure complete candidate source size**

Run:
```bash
wc -c < candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js
```
Expected: integer `<=120000`. If greater than 120000, record `SAFEFILES_SIZE_GATE=FAIL` and stop; do not introduce network fetch, new helper, generic upload or weakened self-maintenance fallback.

- [ ] **Step 6: Commit Task 1**

```bash
git add candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js test-control-plane-root-scripts-typed-staging-capability-v1.js
git commit -m "feat: embed fixed root trust artifacts"
```

---

### Task 2: Fixed Metadata Status Surface and Filesystem Guards

**Files:**
- Modify: `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`
- Modify: `test-control-plane-root-scripts-typed-staging-capability-v1.js`

**Interfaces:**
- Produces `rootTrustStageStatus()` returning metadata only for the two fixed destination files.
- Produces filesystem guard helpers that reject staging-root symlinks, destination symlinks, non-regular destinations and path escape.

- [ ] **Step 1: Add failing metadata/guard tests**

Cover absent files, correct files, wrong SHA, wrong length, symlinked root, symlinked destination, non-regular destination and content non-disclosure.

- [ ] **Step 2: Verify RED**

Run focused test; expected failures reference missing `rootTrustStageStatus`/guard behavior.

- [ ] **Step 3: Implement fixed status and confinement helpers**

The implementation must use only the two compile-time destination names under exact `ROOT_TRUST_STAGE_ROOT`, use `lstat`/`realpath` checks, and return only `exists`, `regular_file`, `symlink`, `bytes`, `sha256`, `mode`, bounded owner/group identity and `ready`.

- [ ] **Step 4: Verify GREEN**

Run focused test; all status/guard cases PASS and no artifact content is returned.

- [ ] **Step 5: Commit Task 2**

```bash
git add candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js test-control-plane-root-scripts-typed-staging-capability-v1.js
git commit -m "feat: add fixed root trust stage status"
```

---

### Task 3: Approval-Bound Atomic Stage Mutation

**Files:**
- Modify: `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`
- Modify: `test-control-plane-root-scripts-typed-staging-capability-v1.js`

**Interfaces:**
- Produces `stageRootTrustTransport(args, deps)`.
- Stage MCP schema exposes only `second_confirmation` literal `CONFIRM_LEVEL_4_CRITICAL`; approval metadata is generated internally.
- Approval operation is fixed to `host_action.control_plane_root_scripts_stage_transport_v1`.

- [ ] **Step 1: Add failing approval and mutation tests**

Cover missing/wrong confirmation, approval validation rejection, consume rejection, replay rejection, mutation-before-approval prohibition, exact two-file staging, atomic temp-then-rename ordering, root/mode enforcement, post-write SHA verification, partial-failure rollback and rollback-failure critical evidence.

- [ ] **Step 2: Verify RED**

Run focused test; expected FAIL because stage mutation does not exist.

- [ ] **Step 3: Implement fixed Approval Center client contract**

Reuse the existing company Approval Center integration pattern already present in the codebase; do not accept approval token, operation, principal, path or hash from MCP caller input. Validation and single-use consume must complete before the first destination mutation.

- [ ] **Step 4: Implement invocation-bound atomic staging**

Create only the fixed staging root, reject symlink/root escape, reconstruct and verify both embedded artifacts in memory, create invocation-owned temporary regular files in the same directory, set `root:root` and `0600`, verify temp SHA/length, then rename to the two exact destinations. Rollback may only remove/restore destinations changed by this invocation.

- [ ] **Step 5: Verify GREEN**

Run focused test. Expected: all approval, atomicity and rollback cases PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js test-control-plane-root-scripts-typed-staging-capability-v1.js
git commit -m "feat: add approval-bound root trust staging"
```

---

### Task 4: Fixed Preflight-Only Execution Surface

**Files:**
- Modify: `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`
- Modify: `test-control-plane-root-scripts-typed-staging-capability-v1.js`

**Interfaces:**
- Produces `runRootTrustTransportPreflight(deps)` with empty MCP input schema.
- Fixed executable: `/usr/local/bin/prhm-node`.
- Fixed argv: staged registration bootstrap path plus exactly `--preflight-only`.

- [ ] **Step 1: Add failing execution-surface tests**

Assert staged metadata is revalidated before spawn, executable is exact, argv is exact, shell is disabled, no environment/caller args are forwarded, `--apply` string cannot enter argv, non-zero exit fails closed and contradictory preflight evidence fails closed.

- [ ] **Step 2: Verify RED**

Run focused test; expected FAIL because preflight runner is absent.

- [ ] **Step 3: Implement preflight runner using `spawnSync`/`execFile` style API**

Before execution call fixed status/verification. Spawn only `/usr/local/bin/prhm-node` with exactly `[fixedBootstrapPath, '--preflight-only']`, `shell:false`, bounded timeout/output, minimal fixed environment and no caller-controlled values.

- [ ] **Step 4: Validate returned evidence**

Require semantically equivalent evidence proving `ok=true`, `preflight_only=true`, production/database/DeployHQ/Honartik/iMotion mutation false and MCP cutover false. Missing/contradictory evidence must fail closed.

- [ ] **Step 5: Verify GREEN**

Run focused test; all fixed-argv and fail-closed cases PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js test-control-plane-root-scripts-typed-staging-capability-v1.js
git commit -m "feat: add fixed root trust transport preflight"
```

---

### Task 5: MCP Tool Registration and Security Regression Suite

**Files:**
- Modify: `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`
- Modify: `test-control-plane-root-scripts-typed-staging-capability-v1.js`

**Interfaces:**
- Registers exactly:
  - `control_plane_root_scripts_stage_transport_v1`
  - `control_plane_root_scripts_stage_transport_status_v1`
  - `control_plane_root_scripts_transport_preflight_v1`

- [ ] **Step 1: Add failing registration/security tests**

Assert exact tool names, stage input only `second_confirmation`, status/preflight empty schemas, no generic path/content/command/URL/repository/SHA fields, no shell/eval/network runtime fetch, no `systemctl` mutation, no `--apply` path, no `/root` write enablement and no unrelated existing safe-files behavior regression.

- [ ] **Step 2: Verify RED**

Run focused test; expected registration failures.

- [ ] **Step 3: Register the three tools without widening existing safe-file schemas**

Add registration after existing base/plugin registration. Keep existing `safe_file_read`, targets and source-mapping compatibility behavior unchanged.

- [ ] **Step 4: Run complete capability suite**

```bash
node test-control-plane-root-scripts-typed-staging-capability-v1.js
```
Expected: all tests PASS, zero skipped security cases.

- [ ] **Step 5: Run syntax and existing relevant regression tests**

```bash
/usr/local/bin/prhm-node --check candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js
```
Then run every repository test whose name contains `safeFiles`, `source-mapping`, `host-actions`, or MCP plugin registration and record exact PASS counts.

- [ ] **Step 6: Re-measure final payload**

```bash
wc -c < candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js
sha256sum candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js
```
Expected: byte count `<=120000`; record candidate SHA for the later self-maintenance request.

- [ ] **Step 7: Commit Task 5**

```bash
git add candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js test-control-plane-root-scripts-typed-staging-capability-v1.js
git commit -m "test: verify typed root staging capability"
```

---

### Task 6: Candidate Verification and Draft Review Gate

**Files:**
- Read: all Task 1-5 changes
- Create only if repository convention requires: draft PR description/evidence; no production files

**Interfaces:**
- Produces immutable candidate branch head, candidate artifact SHA-256, byte count and complete test evidence.

- [ ] **Step 1: Run the full capability suite from a clean isolated worktree**

Expected: all tests PASS, zero skipped security cases.

- [ ] **Step 2: Verify diff scope**

Only intended existing MCP source, focused tests, approved spec/plan and review metadata may change. No Base/Executor/Policy/systemd/application files are part of this candidate.

- [ ] **Step 3: Verify source size and SHA one final time**

Record:
```text
FINAL_SAFEFILES_JS_BYTES=<actual integer <=120000>
FINAL_SAFEFILES_JS_SHA256=<actual 64-hex value>
```
These values become the immutable inputs for the later governed installation gate; they must not be placeholders in the execution report.

- [ ] **Step 4: Create/update Draft PR and report candidate evidence**

Do not merge. Do not create `selfmaint_request` yet.

---

### Task 7: Governed Production Installation — Separate Gate, Not Authorized by This Plan Execution

**Files:**
- Production target later: `/home/agent/ssh-mcp-server/src/plugins/safeFiles.js`

**Interfaces:**
- Consumes live old SHA freshly captured immediately before request and exact candidate content/SHA from Task 6.
- Uses existing `selfmaint_request(target=agent_mcp)` and a fresh `CONFIRM_LEVEL_4_CRITICAL` only after user approval.

- [ ] **Step 1: Fresh read-only live baseline and topology capture**

Re-read live `safeFiles.js` SHA/bytes and public/Blue/Green health. Any drift returns to compatibility review; never disable SHA guard.

- [ ] **Step 2: Create exact SHA-bound self-maintenance request**

Request must target only `src/plugins/safeFiles.js`, bind exact fresh live old SHA and the exact bytes from `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`. This creates a pending Level-4 request; it does not authorize apply.

- [ ] **Step 3: Stop and obtain fresh Level-4 confirmation**

Required literal: `CONFIRM_LEVEL_4_CRITICAL`. Do not reuse any prior confirmation.

- [ ] **Step 4: Apply the stored self-maintenance request and verify rollback/health evidence**

Only the self-maintenance contract's existing target service may restart. Public Blue/Green/router rolling exposure remains a separate later gate.

- [ ] **Step 5: Verify installed source SHA equals candidate SHA and legacy MCP health remains green**

Then stop. Do not stage Root-of-Trust artifacts yet.

---

## Execution Boundary

Normal implementation execution in the development branch covers Tasks 1-6 only. Task 7 is intentionally documented but MUST NOT execute until Task 1-6 evidence is reviewed and a separate production installation gate is explicitly entered.

After successful Task 7, the next distinct workflows are:

```text
1. governed MCP Blue/Green/public schema exposure refresh
2. fresh approved control_plane_root_scripts_stage_transport_v1 request/confirmation
3. fixed status verification
4. fixed control_plane_root_scripts_transport_preflight_v1
5. separate CONTROL_PLANE_BOOTSTRAP_ROOT_OF_TRUST_APPLY_V1 with another fresh Level-4
```

No gate above authorizes DeployHQ adapter installation, canonical node1 recreation, Blue V4 continuation, Honartik cleanup, iMotion target registration or unrelated production mutation.
