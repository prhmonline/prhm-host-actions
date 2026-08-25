# Root Scripts Fixed Stage Action-Specific Request Surface Recovery V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore the existing `root_scripts_fixed_stage_v1` request path using one zero-input action-specific MCP tool while preserving the existing executor/helper unchanged.

**Architecture:** A SHA-bound bootstrap patches exactly three existing files: Host Actions v2 base registry, Approval Center policy, and MCP registry. The MCP tool captures the existing Host Actions v2 request handler and calls it only with the compile-time action `root_scripts_fixed_stage_v1`; existing `host_action_v2_apply` remains the apply surface.

**Tech Stack:** Node.js built-ins, JSON policy, MCP/Zod existing registry patterns.

**Spec:** `SPEC_APPROVED_PRHM_ROOT_SCRIPTS_FIXED_STAGE_ACTION_SPECIFIC_REQUEST_SURFACE_RECOVERY_V1`

## Global Constraints
- Base baseline SHA: `e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd`.
- Policy baseline SHA: `76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d`.
- MCP registry baseline SHA: `484005617703516bbba877482330428e3b74ea3b7ce227685506aad11edf7762`.
- Existing executor/helper are immutable in this gate; helper SHA: `50c07d21fb2def962e6f801663f3293ce7c25ba00a410caa039792832910c5ee`.
- Fixed action: `root_scripts_fixed_stage_v1`.
- Fixed operation: `host_action.root_scripts_fixed_stage_v1`.
- Fixed rollback: `root-stage-v1:invocation-bound-two-files`.
- New MCP tool: `root_scripts_fixed_stage_request_v1` with empty input schema.
- No arbitrary action/path/command/payload/SQL/network input.

### Task 1: Fail-first contract tests
- [ ] Verify test fails because bootstrap module is absent.
- [ ] Cover exact base entry, policy operation/scope, zero-input MCP tool, fixed action call, and rejection of ambiguous/missing anchors.

### Task 2: Minimal SHA-bound bootstrap
- [ ] Implement pure patch functions for Base, Policy, and MCP registry.
- [ ] Implement baseline SHA verification, preflight, atomic apply, backups, rollback, confirmation literal, and post-write SHA verification.
- [ ] Touch no executor/helper/application/database files.

### Task 3: Verification and staging
- [ ] Run focused test and Node syntax check.
- [ ] Record candidate SHA/bytes.
- [ ] Persist candidate/test/plan on an isolated GitHub branch.
- [ ] Stage candidate only if a sanctioned installer exists; do not use generic root write/selfmaint bypass.
