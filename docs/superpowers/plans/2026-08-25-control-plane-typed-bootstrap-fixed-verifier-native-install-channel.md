# Control Plane Typed Bootstrap Fixed Verifier Native Install Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and TDD a zero-input, SHA-bound native installer action for `control_plane_typed_bootstrap_fixed_verifier_bootstrap_v1` without applying it server-side in this Gate.

**Architecture:** Model the current base registry, executor, MCP Host Actions v2 plugin and approval policy as exact byte inputs. Produce deterministic patched bytes plus a transaction journal and rollback model. Bind everything to fresh production SHA values captured immediately before RED tests.

**Tech Stack:** Node.js 20, `node:test`, `crypto`, JSON fixtures, GitHub branch `fix/park-bazar-production-finalize-v17`.

**Spec:** `docs/superpowers/specs/2026-08-25-control-plane-typed-bootstrap-fixed-verifier-native-install-channel-design.md`

## Global Constraints
- Native installer action: `control_plane_typed_bootstrap_fixed_verifier_native_install_v1`.
- Target bootstrap action: `control_plane_typed_bootstrap_fixed_verifier_bootstrap_v1`.
- Verifier implementation SHA-256: `f5e3cb6a9ce6c88229ffbd2fafd1e48742562f8c3edbc7aac113e2cb4f292b5a`.
- Bootstrap planner commit: `0d40e9e051cc39d23fed106fd7b301c7e1654568`.
- Level-4 only; no arbitrary command/path/repo/payload/network/DB inputs.
- No reuse of the Honartik-specific installer.
- No Park Bazar production mutation.

### Task 1: Capture fresh baselines and establish RED
- [ ] Read SHA-256 for `/opt/prhm-agent-selfmaint/server.js`, `/opt/prhm-agent-selfmaint-exec/server.js`, `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`, and `/opt/prhm-company-control-plane/config/approval-policy.json`.
- [ ] Create `test-v1-control-plane-typed-bootstrap-fixed-verifier-native-install.js` importing a not-yet-existing implementation.
- [ ] Assert exact action names, verifier SHA, Level-4-only contract, zero-input surface and the four fresh baseline SHA values.
- [ ] Run `node --test ...` and require `MODULE_NOT_FOUND`.
- [ ] Commit RED-only test.

### Task 2: Implement exact registration planner
- [ ] Create `control-plane-typed-bootstrap-fixed-verifier-native-install-v1.js`.
- [ ] Implement `planNativeInstall({baseSource,executorSource,mcpSource,policySource,currentSha})` that verifies all four hashes before computing changes.
- [ ] Add only the fixed base registry action/operation entry, executor action/handler dispatch, MCP enum exposure and approval-policy binding.
- [ ] Reject zero/multiple anchors and conflicting existing registrations.
- [ ] Require deterministic byte output and second-run idempotency.
- [ ] Run focused tests to GREEN and commit.

### Task 3: Add transaction and rollback model
- [ ] Add failing tests for failure after base mutation, executor mutation, MCP mutation and policy mutation.
- [ ] Implement invocation-local before-images and reverse-order rollback.
- [ ] Require byte-identical restoration on every simulated failure.
- [ ] Require clean success to report `rollbackPerformed=false`.
- [ ] Run tests and commit.

### Task 4: Enforce security boundary
- [ ] Add negative tests for arbitrary `command`, `path`, `repo`, `payload`, `url`, `host`, `service`, `sql`, `credential` or generic args.
- [ ] Static-scan source for `sshpass`, self-SSH, `systemd-run`, traversal helpers, `DROP DATABASE`, `CREATE DATABASE`, `park_bazar_migrate_v1`, `ProtectHome` widening and generic `ReadWritePaths` widening.
- [ ] Confirm no reference to `honartik_git_worktree_fixed_v1` exists in implementation.
- [ ] Run tests and commit.

### Task 5: Bind manifest and immutable evidence
- [ ] Create `control-plane-typed-bootstrap-fixed-verifier-native-install-v1.manifest.json` with schema version, action, target action, verifier SHA, four baseline SHAs, implementation SHA, test SHA, `level4_required=true`, `zero_input=true`, `park_production_mutation=false`.
- [ ] Add manifest SHA recomputation tests.
- [ ] Run `node --check` on implementation and test.
- [ ] Run complete focused `node --test` suite.
- [ ] Commit and read files back from immutable GitHub commit; require byte-identical SHA match.

### Task 6: No-mutation verification
- [ ] Re-read all four control-plane production SHA values and require no change from Task 1.
- [ ] Run `park_bazar_delivery_audit_v1` and confirm Park entrypoint SHA values are unchanged.
- [ ] Confirm no `host_action_v2_apply`, `selfmaint_apply`, safe-file upload commit or production write was invoked in this Gate.
- [ ] Report PASS only if Tasks 1–5 and no-mutation checks pass.

## Self-Review
- Spec coverage: baseline binding, exact registration scope, rollback, Level-4 fail-closed, idempotency, forbidden surfaces, manifest binding and no-Park mutation are mapped to explicit tasks.
- No placeholders remain.
- Function/action names are consistent across tasks.
