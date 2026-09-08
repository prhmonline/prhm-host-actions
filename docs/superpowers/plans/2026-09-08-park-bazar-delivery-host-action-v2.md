# Park Bazar Delivery Host Action V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install and execute a fixed SHA-bound Level-3 Host Action v2 that deploys exactly the three Park Bazar hardening files from CF Park commit `451501c30fb4fcb71ce4220cacb0bee169796399`.

**Architecture:** Reuse the existing V27 control-plane installer architecture, but remove runtime Git/worktree mutation. Embed the exact release bytes and enforce old/new SHA-256, a tenant-app-only writable sandbox, PHP lint, runtime probes, automatic file rollback, and a single-use Level-3 approval.

**Tech Stack:** Node.js Host Actions v2, systemd transient sandbox, PHP CLI lint, curl runtime probes, GitHub canonical release commit.

**Spec:** Conversation-approved Park Bazar fixed/SHA-bound Host Action design.

## Global Constraints

- Action: `park_bazar_delivery_patch_v1` only.
- Production root: `/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app` only.
- No database mutation.
- No runtime Git worktree, no force push, no arbitrary command/path input.
- Release commit: `451501c30fb4fcb71ce4220cacb0bee169796399`.
- Preimage and final SHA-256 must match exactly.
- PHP lint and runtime `/home`, `/theater/190`, `/theater/193`, `/theater/244` must pass.
- Any failure after mutation must rollback written files.

---

### Task 1: Contract

**Files:**
- Modify: `test-v27-park-bazar-delivery.js`
- Create: `test-v27-1-park-bazar-delivery-scope.js`

- [x] Write RED tests for Level-3/high policy, narrow `ReadWritePaths`, exact release commit/final SHA set, and absence of runtime Git/worktree.
- [x] Run tests and verify RED for the intended old V27 behavior.

### Task 2: Fixed release helper

**Files:**
- Modify: `bootstrap-host-actions-v27-park-bazar-delivery.js`

- [x] Change Park policy to Level-3/high and add the action to the Level-3 set.
- [x] Limit transient sandbox writes to tenant app + Park backup/result state.
- [x] Embed exact bytes from release commit `451501c30fb4fcb71ce4220cacb0bee169796399`.
- [x] Enforce exact preimage/final SHA-256 and regular-file checks.
- [x] Add atomic writes, backups, PHP lint, runtime probes, idempotent final-state handling and rollback.
- [x] Remove runtime Git/worktree mutation.
- [x] Run Node syntax check and full V27 tests; require 12/12 GREEN.

### Task 3: Git and promotion

- [ ] Commit these files non-force on `feature/park-bazar-pbcinema-cutover-v1` and verify remote diff.
- [ ] Forward-bind installer baselines to current control-plane owners if needed.
- [ ] Promote/install the fixed Host Action and refresh MCP/API replicas.
- [ ] Create fresh Level-3 request and execute `park_bazar_delivery_patch_v1`.

### Task 4: Delivery verification

- [ ] Verify final runtime SHAs and PHP lint.
- [ ] Run `park_bazar_delivery_audit_v1`.
- [ ] Run Park runtime slider/home/theater UAT and CF Park tenant regression.
- [ ] Merge canonical application hardening branch non-force to main and verify remote/runtime parity.
- [ ] Complete DNS/Edge/SSL and HTTPS regression before DELIVERY READY.
