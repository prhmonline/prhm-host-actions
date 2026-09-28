# Current-Owner Binding Refresh — Design Specification

**Date:** 2026-09-28  
**Repository:** `prhmonline/prhm-host-actions`  
**Status:** Approved architecture; implementation not started  
**Primary objective:** Restore a single, fail-closed current-owner binding chain for PRHM Agent 3 so Titan contract/preflight can execute against the live control-plane owners without stale embedded SHA or anchor drift.

## 1. Problem statement

The Titan frontend handoff is blocked before deployment. Titan production itself has not been cut over. The failure is in the control-plane chain that prepares and validates the Titan handoff sandbox.

Observed failures now span multiple independently versioned consumers:

- Titan contract and Titan preflight fail with `titan_handoff_sandbox_failed:Unknown assignment: RestrictSUIDSGID=true`.
- `control_plane_typed_bootstrap_current_baseline_refresh_v1` previously failed before target mutation because `prhm-agent-selfmaint-exec.service` could not write `/var/backups/prhm-current-baseline-refresh-v1` under `ProtectSystem=strict`.
- Registry bootstrap currently fails with `registry_bridge_baseline_sha_mismatch`.
- V19 reader currently fails with `v19_reader_sha_mismatch` against the live bootstrap artifact.
- V19 forward rebase fails with `helper_preimage_drift`.
- V19 semantic repair fails with `v19_cc_title_preimage_drift`.
- V19 current-baseline rebuild fails with `testbaseline_anchor_0`.

These are not independent product bugs. They are symptoms of a control-plane design that embeds owner-specific hashes and text anchors in several consumers. Once one owner evolves, multiple downstream repair tools can become stale at the same time, and each stale repair tool can then block the next repair.

## 2. Design intent

Introduce one canonical, zero-arbitrary-input current-owner binding subsystem that separates **owner discovery** from **consumer binding**.

The subsystem must:

1. Discover exact live owner identity from a fixed allowlist of control-plane files/services.
2. Persist a deterministic manifest of those owner identities and SHA-256 values.
3. Rebind only explicitly allowlisted consumers to that manifest.
4. Eliminate text-anchor chaining as the source of truth for future refreshes.
5. Validate the full chain before any refresh is considered successful.
6. Roll back all mutations to exact preimages if any validation fails.
7. Never deploy or mutate Titan production as part of this repair.

The proposed public action name is:

`control_plane_current_owner_binding_refresh_v1`

The action accepts no path, command, SHA, hostname, service name, arbitrary content, repository selector, or environment selector from the caller.

## 3. Non-goals

This work does **not**:

- deploy Titan;
- change Titan application source;
- change Titan database state;
- change DirectAdmin, DNS, TLS, or public routing;
- relax `ProtectSystem=strict` globally;
- remove fail-closed SHA checking;
- reset or clean unrelated Git changes;
- force-push any repository branch;
- create a generic privileged shell or generic systemd writer;
- broaden existing PRHM Agent 3 permissions beyond the fixed control-plane repair scope.

## 4. Core architecture

### 4.1 Canonical current-owner manifest

A generated manifest becomes the single binding authority for this repair chain. It is produced server-side from fixed, predeclared owner paths and service metadata.

Suggested persisted location:

`/var/lib/prhm-agent-selfmaint-exec/current-owner-binding-v1/manifest.json`

The manifest is data, not executable code. It contains only bounded metadata such as:

- schema version;
- capture timestamp;
- owner logical ID;
- canonical fixed path or service ID;
- SHA-256 of regular files;
- byte count;
- selected service metadata required by contracts;
- manifest SHA-256.

No secret values, environment contents, credentials, tokens, arbitrary file contents, or approval material are stored in the manifest.

### 4.2 Fixed owner inventory

The refresh action must define its owner inventory in source code. At minimum it covers the owners necessary to repair the currently observed chain, including the current Agent API control-plane owner, the current MCP/registry bridge owner, the V19 bootstrap/test owners, the rolling-refresh owner, and the self-maint executor binding relevant to baseline refresh.

Every filesystem owner must satisfy all of the following before its SHA can enter the manifest:

- expected fixed absolute path;
- `lstat` regular file or expected fixed directory/service type;
- no symlink;
- `realpath` equals the expected canonical path;
- size within a fixed bound;
- hash computed from exact bytes;
- no caller-controlled path expansion.

### 4.3 Consumer adapters

Each stale consumer is handled by a dedicated fixed adapter. An adapter has exactly one responsibility: transform or install one known consumer so that it resolves its binding from the canonical current-owner manifest rather than from a historical embedded owner SHA.

Initial adapters should cover only the currently blocking chain:

1. Registry/bootstrap bridge binding.
2. V19 reader/helper binding.
3. Current-baseline refresh binding.
4. Rolling-refresh binding required to load the live Agent API compatibility owner.
5. Titan handoff sandbox binding required by `titan_host_actions_worktree_test_v1` and `titan_front_handoff_preflight_v2`.

Adapters are fixed in code; there is no generic adapter API exposed to callers.

### 4.4 One-time migration, steady-state refresh

The first release may require a one-time exact-preimage migration because current consumers still contain historical inline SHA/anchor logic.

That migration must be distinguished from steady-state refresh:

- **Migration:** exact current SHA is captured, a complete candidate for each allowlisted consumer is generated, and the consumer is moved to manifest-based resolution. Migration is permitted only from enumerated preimages or from a verified already-migrated state.
- **Steady state:** later owner changes update the manifest and regenerate only the fixed binding data/consumer outputs. No historical text anchor is needed.

The desired end state is that a normal owner change does not require a new generation of V18/V19/V35 repair scripts solely to teach them a new SHA.

## 5. Transaction model

The refresh is an all-or-nothing transaction.

### Phase A — preflight

Before any mutation:

1. Acquire an action-local lock so two refreshes cannot run concurrently.
2. Verify `selfmaint_health` is GREEN.
3. Inventory all fixed owners and compute the candidate manifest.
4. Inventory all target consumers and persist exact preimage bytes, SHA-256, uid/gid/mode, and canonical path.
5. Verify every target is an allowed regular file/config target and not a symlink.
6. Verify no unexpected consumer state is present.
7. Verify required backup/state directories are writable by the execution sandbox before changing consumers.
8. Produce a preflight evidence object with `production_mutation:false`.

Any failure in Phase A stops with zero mutation.

### Phase B — candidate materialization

Candidates are created in action-owned state directories, never directly over live targets.

Each candidate must pass:

- syntax validation where applicable;
- deterministic SHA calculation;
- adapter-specific static contract checks;
- manifest schema validation.

No target is replaced until all candidates are ready.

### Phase C — atomic application

Apply candidates in a fixed order using same-filesystem temporary files and atomic rename where applicable.

Persist a transaction record before the first live replacement. The record includes exact preimage SHAs and candidate SHAs but no secret material.

### Phase D — verification

The transaction is successful only when all required postconditions pass.

Required verification sequence:

1. `selfmaint_health` GREEN.
2. V19 contract: 17/17 GREEN.
3. Registry action-specific bootstrap resolves without `registry_bridge_baseline_sha_mismatch`.
4. Current-baseline refresh preflight is able to create its backup in the intended writable backup root without EROFS.
5. Existing-topology rolling refresh path validates against the live owner SHA.
6. `titan_host_actions_worktree_test_v1({suite:"contract_v1"})` GREEN.
7. `titan_front_handoff_preflight_v2()` GREEN.

The repair action itself must not call the Titan deploy tool.

### Phase E — rollback

If any candidate application or verification step fails:

1. Restore every already-written target from the exact persisted preimage.
2. Restore original uid/gid/mode.
3. Reload/restart only services explicitly affected by the adapter set.
4. Re-run basic health verification.
5. Persist rollback evidence.
6. Return failure with `rollback_performed:true`.

If rollback itself fails, return a distinct fail-closed `rollback_failed` state containing bounded diagnostic evidence. Do not proceed to later steps.

## 6. Systemd confinement

The repair must preserve strong sandboxing.

`ProtectSystem=strict` remains enabled. Writable paths must be explicit and minimal.

For the known baseline-refresh EROFS case, the design permits only the fixed backup/state path required by the action, for example:

`/var/backups/prhm-current-baseline-refresh-v1`

The implementation may choose either:

- a persistent fixed systemd drop-in scoped to `prhm-agent-selfmaint-exec.service`, or
- moving the baseline-refresh backup into an existing fixed writable `StateDirectory`.

The implementation plan must select one, not both. The preferred choice is the one that introduces the smaller long-term privilege surface while keeping backup-before-write semantics intact.

No `ReadWritePaths=/var/backups` broad grant is allowed.

## 7. Approval and policy semantics

The system must not infer or downgrade approval level from prior user confirmations.

- Request creation and execution remain separate operations.
- Every request is one-time and expiry-bound.
- Execution uses the exact confirmation literal returned by the active policy for that request.
- A confirmation for an expired or different request is never reused.
- If policy classifies migration/refresh as Level-4, the exact Level-4 literal is required.
- If a later steady-state refresh is classified differently by policy, the runtime policy result is authoritative.

The action must reject caller-supplied approval tokens, arbitrary hashes, paths, commands, or replacement source.

## 8. Git and repository safety

Implementation development occurs on an isolated branch/worktree.

Requirements:

- never clean/reset unrelated state in `/home/prhm/worktrees/prhm-host-actions`;
- no force push;
- no rewrite of unrelated commits;
- exact task files only are staged by automated Git closure;
- contract must be GREEN before commit/push;
- remote/local HEAD equality is verified after push;
- unrelated untracked/dirty state is preserved.

The current design branch is documentation-only. Implementation requires a separate implementation branch/worktree after the implementation plan is approved.

## 9. Testing strategy

Implementation uses TDD.

### RED contracts

Tests must first demonstrate the currently missing behavior. At minimum:

- manifest generation rejects symlink or noncanonical owners;
- stale consumer binding is detected;
- refresh refuses an unknown preimage;
- refresh refuses arbitrary fields/input;
- backup root confinement fails closed if not writable;
- no Titan deployment occurs from the repair action.

### GREEN contracts

After implementation:

- deterministic manifest generated from fixed owners;
- exact preimages persisted before live mutation;
- fixed adapters bind to manifest owner identities;
- all candidates pass syntax/static checks;
- V19 suite passes 17/17;
- registry bootstrap mismatch is gone;
- baseline refresh can back up before write;
- Titan contract passes;
- Titan preflight passes;
- forced injected failure restores byte-identical preimages.

### Regression

The implementation plan must include the broader existing prhm-host-actions contract suite that is feasible in the isolated worktree, and report any unrelated pre-existing failures instead of hiding them.

## 10. Observability and evidence

Every run returns bounded structured evidence with at least:

- action name/version;
- manifest SHA;
- owner logical IDs and SHA values;
- consumer preimage/candidate SHA values;
- transaction ID;
- verification results;
- rollback status;
- production application mutation flag;
- database mutation flag;
- Titan deploy/cutover flag.

Secrets and full environment data are never returned.

A successful repair must explicitly report:

`production_application_mutation:false`

and

`titan_cutover:false`

because the repair only prepares the control plane for the later deploy gate.

## 11. Final handoff sequence

Once `control_plane_current_owner_binding_refresh_v1` completes GREEN:

1. Verify `selfmaint_health` GREEN.
2. Run the fixed existing-topology rolling refresh only if required to load the newly rebound Agent API/MCP owner.
3. Verify all blue/green slots are healthy and source fingerprints match the intended owner state.
4. Run `titan_host_actions_worktree_test_v1({suite:"contract_v1"})`.
5. Run `titan_front_handoff_preflight_v2()`.
6. If either is not GREEN, stop; do not deploy.
7. If both are GREEN, stop at the Titan deploy gate and request the exact literal `CONFIRM_DEPLOY_PRODUCTION`.
8. Only after that fresh deploy confirmation may `titan_front_handoff_deploy_v2({confirmation:"CONFIRM_DEPLOY_PRODUCTION"})` be called.

## 12. Acceptance criteria

This design is complete when implementation can demonstrate all of the following in one evidence chain:

- no stale current-owner binding error from registry/V19 consumers;
- no `EROFS` from the baseline-refresh backup step;
- no `Unknown assignment: RestrictSUIDSGID=true` from the Titan handoff sandbox;
- V19 contract 17/17 GREEN;
- Titan contract GREEN;
- Titan preflight GREEN;
- self-maint executor GREEN;
- no Titan deploy or cutover performed by the repair;
- exact-preimage rollback tested and proven;
- no unrelated repository state modified.

## 13. Design decision summary

The central decision is to stop repairing stale SHA/anchor chains one tool at a time. The current-owner manifest becomes the authoritative binding boundary, and fixed consumer adapters migrate the currently blocking chain to that authority in one rollback-safe transaction.

This preserves fail-closed behavior while removing the circular failure mode where the repair tool itself becomes stale before it can repair the next layer.
