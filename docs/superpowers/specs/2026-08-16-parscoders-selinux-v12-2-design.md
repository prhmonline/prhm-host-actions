# ParsCoders SELinux v12.2 Remediation Design

**Date:** 2026-08-16  
**Status:** Approved design; implementation not started  
**Approval:** `SPEC_APPROVED_PARSCODERS_SELINUX_V12_2`

## Goal

Make the restored ParsCoders runtime-v3 collector and scorer executable by systemd under SELinux Enforcing without weakening SELinux, widening home-directory execution permissions, changing LeadOps business logic, or enabling any P0/bid/proposal/send path.

The change must repair the current Production state and also make the canonical restore action safe against the same failure in future installs.

## Proven incident and root cause

The v12/v12.1 runtime restore completed its controlled `runuser` validation and enabled the existing timer, but the first real timer trigger at `2026-08-16 12:36:47 +0330` failed before the collector script began executing:

```text
leadops-parscoders-collector.service: Failed at step EXEC spawning /home/drtarjomeh/leadops/runtime-v3/collector: Permission denied
leadops-parscoders-collector.service: Main process exited, code=exited, status=203/EXEC
```

The corresponding SELinux audit record proves the cause:

```text
avc: denied { execute }
scontext=system_u:system_r:init_t:s0
tcontext=system_u:object_r:user_home_t:s0
tclass=file
name="collector"
permissive=0
```

Relevant established state:

- SELinux mode is `Enforcing`.
- Canonical collector and scorer live under `/home/drtarjomeh/leadops/runtime-v3`.
- The canonical collector currently has SELinux type `user_home_t`.
- The legacy `/usr/local/sbin/leadops-parscoders-collector` has type `bin_t`.
- Unix mode/ownership and parent traversal are valid for `drtarjomeh`.
- The filesystem is not mounted `noexec`.
- `#!/usr/bin/env bash`, `/usr/bin/env`, and bash are valid.
- The timer did trigger successfully; timer scheduling is not the cause.
- No local `semanage fcontext` mapping currently exists for the ParsCoders runtime paths.

Therefore the fault is specifically SELinux denying `init_t` execution of a `user_home_t` file. It is not a timer, shebang, Unix permission, mount, or PostgreSQL failure.

## Scope

### In scope

1. Give only the two canonical executable files a persistent SELinux executable type:
   - `/home/drtarjomeh/leadops/runtime-v3/collector`
   - `/home/drtarjomeh/leadops/runtime-v3/scorer`
2. Keep `.env`, SQL, `data/`, and the rest of the runtime directory on their normal home-directory labels.
3. Add real systemd-path rollback-only validation so SELinux/systemd execution failures are detected before timer activation or before a remediation is considered successful.
4. Update the existing runtime-v3 restore helper so future atomic replacements are relabelled before validation/activation.
5. Add a separate exact-state-bound one-time Production remediation action for the already-restored runtime.
6. Preserve all existing least-privilege PostgreSQL grants and service identity constraints.
7. Preserve all P0/send safety flags.

### Explicitly out of scope

- Disabling SELinux or switching to Permissive.
- `setenforce 0` even temporarily.
- `chcon` as the persistent fix.
- `audit2allow` or generation/installation of a custom SELinux policy module.
- Labelling the whole `/home/drtarjomeh`, `leadops`, or `runtime-v3` tree as executable.
- Granting execute permission to the general `user_home_t` type.
- Moving the runtime to `/usr/local/sbin` or `/usr/local/libexec` in this incident.
- Changing collector filtering, scoring, SQL semantics, marketplace logic, proposal generation, bid behavior, or send behavior.
- Fixing the duplicate timer `Unit=` warning; it is proven non-blocking and is deliberately isolated from this remediation.

## Considered approaches

### A. Exact-path persistent `bin_t` mappings — selected

Use local SELinux file-context mappings for only `collector` and `scorer`, followed by `restorecon` on those two exact files.

Advantages:

- Minimal blast radius.
- Uses the standard persistent SELinux file-labelling mechanism.
- Survives normal relabel/restorecon operations.
- Does not weaken policy for home files generally.
- Keeps existing canonical paths and deployment contracts.

### B. Move executables to `/usr/local/libexec` or `/usr/local/sbin`

This would naturally fit executable labels but changes canonical paths, systemd ExecStart contracts, rollback state, and deployment assumptions. It is broader than necessary for the proven fault and is rejected for v12.2.

### C. Custom policy allowing execution of `user_home_t`

This grants a broader capability than required and increases policy maintenance burden. It is rejected.

## Architecture

v12.2 has two deliberately separate mechanisms.

### 1. Permanent restore-helper hardening

The existing `leadops_parscoders_runtime_v3_restore_v1` implementation is updated so every future canonical runtime install performs SELinux handling as part of the restore transaction.

After atomic creation of `collector` and `scorer`, but before runtime validation or timer activation, the helper must:

1. Confirm SELinux tooling is present when SELinux is Enforcing.
2. Inspect existing local fcontext rules for each exact executable path.
3. If no local rule exists, add an exact-path rule with type `bin_t`.
4. If an exact-path rule already exists with `bin_t`, treat it as idempotent.
5. If an existing local rule for either path specifies a different type or is otherwise ambiguous, fail closed rather than replacing it silently.
6. Run `restorecon` only for the two executable paths.
7. Verify the effective type of both files is `bin_t` before any systemd-path validation.

The helper must record whether each mapping was pre-existing or created by this execution so rollback removes only state created by the action.

Because the helper writes files atomically, persistent fcontext rules alone are not sufficient: the helper must explicitly relabel the newly installed executable files after atomic rename and before execution.

### 2. One-time current-state remediation

Add a separate Level-4 critical action, provisionally named:

`leadops_parscoders_selinux_exec_remediate_v1`

This action repairs the already-installed Production runtime without rerunning the full runtime migration or recreating DB roles.

It must be exact-state-bound to the currently verified v12.1 installation. At minimum its preflight must verify:

- canonical collector/scorer files exist and match their expected candidate hashes;
- effective collector/scorer service users and groups are `drtarjomeh`;
- effective ExecStart values point to canonical runtime-v3 paths;
- timer is enabled and currently configured for the existing canonical collector service;
- SELinux is Enforcing;
- current executable types are the proven pre-remediation state (`user_home_t`) unless the action detects the already-remediated exact expected state;
- no conflicting local fcontext rules exist for either exact path;
- protected control-plane/helper SHA bindings match the intended v12.1 baseline;
- P0/send flags are still in the safe state.

It must not recreate or expand the `leadops_parscoders` database role.

## Exact SELinux state change

Only these two exact file paths may receive local mappings to `bin_t`:

```text
/home/drtarjomeh/leadops/runtime-v3/collector
/home/drtarjomeh/leadops/runtime-v3/scorer
```

The implementation must use persistent `semanage fcontext` state plus `restorecon`. A recursive regex covering the runtime directory is prohibited.

Expected post-remediation labels:

```text
collector -> system_u:object_r:bin_t:s0 (type must be bin_t)
scorer    -> system_u:object_r:bin_t:s0 (type must be bin_t)
```

The acceptance contract is based on SELinux type, not a hard-coded SELinux user field, because `restorecon` may normalize the complete context according to host policy.

Expected unchanged labels include:

- `/home/drtarjomeh/leadops/runtime-v3/.env`
- `/home/drtarjomeh/leadops/runtime-v3/rules-v3-parscoders.sql`
- `/home/drtarjomeh/leadops/runtime-v3/data`
- the runtime-v3 directory itself

These must not be promoted to `bin_t` by v12.2.

## Systemd-path validation

The previous restore helper validated with:

```text
runuser -u drtarjomeh -- /home/drtarjomeh/leadops/runtime-v3/collector
```

That proved Unix identity and runtime behavior but did not reproduce the SELinux execution path used by systemd. This gap allowed the first timer execution to fail after rollout.

v12.2 must add a systemd-originated validation that executes the canonical collector under the same operational identity with:

```text
PARSCODERS_VALIDATE_ONLY=1
```

Preferred implementation: a uniquely named transient `systemd-run` unit with at least the relevant service identity and hardening properties mirrored from the production unit (`User=drtarjomeh`, `Group=drtarjomeh`, `NoNewPrivileges=yes`, `ProtectHome=read-only`, `ProtectSystem=full`). It must execute the canonical collector path, wait for completion, collect the result, and be removed/collected afterwards.

This avoids temporarily rewriting the live service drop-in merely to inject a validation environment variable while still exercising systemd/SELinux execution.

The collector's existing validation branch must continue to convert its SQL transaction to rollback-only and must pass `PARSCODERS_VALIDATE_ONLY=1` to the canonical scorer. Thus the validation also exercises execution of the scorer from the canonical runtime without committed business changes.

Success requires:

- transient unit exit status 0;
- no `203/EXEC`;
- no AVC denial for execution of collector or scorer during the validation window;
- before/after safety counters unchanged;
- no external send evidence;
- no committed opportunity/evaluation/outbox change caused by validation.

If any later AVC reveals that non-executable runtime content needs read access, the action must fail closed and rollback. It must not automatically widen SELinux permissions or labels beyond the approved two executable paths.

## Timer race handling

For the one-time remediation, the existing timer must not race with label changes or validation.

The action must record the timer's enabled/active state, stop the timer while the two labels are changed and the transient validation runs, then restore the prior active state after successful validation. It must not change the intended schedule.

On rollback, it must restore the timer to its exact pre-action enabled/active state after restoring SELinux state.

The permanent full restore helper already activates the timer after validation; its sequencing must remain validation-before-activation.

## Rollback

Rollback is state-aware and must restore only state introduced by the current action.

For each executable path:

- record original full context;
- record whether an exact local fcontext rule existed before the action;
- if this action created the `bin_t` mapping, remove that exact mapping during rollback;
- run `restorecon` after mapping removal so the path returns to its policy-default type;
- if a same-type rule pre-existed, preserve it;
- if an unexpected/conflicting pre-existing rule exists, fail before mutation.

The remediation must also restore the prior timer active state. A failed remediation must not leave the timer disabled merely because validation failed.

No rollback path may toggle SELinux mode or install a policy module.

## Safety invariants

The following values remain non-negotiable throughout preflight, validation, success, and rollback:

- `P0_SHADOW_MODE=true`
- `P0_DECISION_ENABLED=false`
- `PROPOSAL_AUTO_SEND_ENABLED=false`
- `AUTO_PROPOSAL_ENABLED=false`
- P0 Live=false
- P0 Decision=false
- Proposal Send=false
- Bid Send=false
- Auto Send=false
- External Send=false

Additional invariants:

- `drtarjomeh` is not added to the Docker group.
- No Docker-based LeadOps runtime execution is reintroduced.
- Existing least-privilege DB grants are unchanged.
- Full-table SELECT on `automation.outbox_events` remains false.
- The approved column-level `SELECT(idempotency_key)` grant remains unchanged.
- No new DELETE privilege is granted.
- No business/send table mutation is committed by validation.

## Result contract

The one-time remediation result should expose enough evidence for independent verification without leaking secrets. Recommended fields include:

```json
{
  "ok": true,
  "action": "leadops_parscoders_selinux_exec_remediate_v1",
  "selinux_mode": "Enforcing",
  "fcontext_scope": "exact_paths_only",
  "collector_type_before": "user_home_t",
  "collector_type_after": "bin_t",
  "scorer_type_before": "user_home_t",
  "scorer_type_after": "bin_t",
  "systemd_validation": true,
  "validation_mode": "rollback_only",
  "validation_exit_status": 0,
  "timer_state_restored": true,
  "committed_database_mutation": false,
  "business_mutation": false,
  "external_send": false,
  "p0_live": false,
  "p0_decision": false,
  "proposal_send": false,
  "bid_send": false,
  "auto_send": false
}
```

No plaintext DB credential, environment secret, or approval token may appear in the result or logs.

## TDD requirements

Implementation must begin with failing contract tests. Tests must prove at minimum:

1. Only the exact collector/scorer paths can receive SELinux executable mappings.
2. Recursive/broad runtime/home `bin_t` mappings are rejected.
3. `setenforce`, `chcon`, `audit2allow`, policy-module installation, and permissive-mode workarounds are absent.
4. The permanent restore helper relabels after atomic install and before validation/timer activation.
5. Conflicting pre-existing local fcontext rules fail closed before mutation.
6. Rollback deletes only mappings created by the current action and restores default labels.
7. The one-time remediation is bound to exact v12.1 runtime/control-plane state.
8. Systemd-originated validation is required; a `runuser`-only validation is no longer sufficient.
9. Validation uses `PARSCODERS_VALIDATE_ONLY=1` and preserves rollback-only SQL semantics.
10. Timer state is restored after both success and failure.
11. P0/send safety assertions are checked before and after validation.
12. Existing DB least-privilege grants are neither broadened nor recreated by the remediation.
13. The timer duplicate `Unit=` warning is not modified by this patch.
14. Result metadata accurately reports labels, validation, timer restoration, and zero external/business mutation.

## Production rollout gates

Implementation and rollout are separate gates.

1. Implement tests and code on a dedicated branch.
2. Run targeted v12.2 tests RED -> GREEN.
3. Run all existing Host Action/Company OS regression tests.
4. Review changed-file scope and exact SHAs.
5. Merge only after tests/review pass.
6. Run a non-mutating bootstrap/remediation preflight on Production.
7. Install/register the fixed action/helper only after protected SHA checks pass.
8. Create one fresh Level-4 request for the one-time remediation.
9. Require one fresh `CONFIRM_LEVEL_4_CRITICAL` bound to that request.
10. Apply once.
11. Poll persisted status/result.
12. Independently verify SELinux labels, service identity, timer state, first subsequent real timer run, DB grants, counters, and all send/P0 invariants.

A confirmation from any older request must never authorize the new remediation request.

## Acceptance criteria

v12.2 is complete only when all of the following are proven:

- SELinux remains Enforcing.
- Only collector and scorer have the approved persistent executable mapping.
- Collector and scorer effective types are `bin_t`.
- `.env`, SQL, `data/`, and parent runtime directories were not broadly relabelled executable.
- A rollback-only validation launched through systemd succeeds with exit status 0.
- No collector/scorer execution AVC is generated during that validation.
- The timer is enabled/active with the intended schedule after remediation.
- The next real timer-triggered collector execution passes the EXEC stage and completes successfully.
- Existing DB least-privilege grants remain exact.
- No external send occurs.
- No P0/send flag changes.
- No committed business mutation is caused by the validation.
- The full restore helper contains the same SELinux protection so future atomic installs cannot regress to `user_home_t` execution failure.

Until the first real post-remediation timer run is independently verified, the incident is not considered fully closed.