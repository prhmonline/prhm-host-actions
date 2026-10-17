# Honartik Root Host Action V2 Installer — actual on-host source review

**Date:** 2026-10-18  
**Host:** `prhm-production`  
**Status:** **BLOCK INSTALL** — semantic and recovery defects identified; no live source writes performed.  
**Reviewed artifact:** `/opt/prhm-agent-selfmaint-exec/actions/host-action-v2-installer-v1.js`. Original SHA256 `0f76d3ad65ba267c045dd545d249e0b2083f4aedf8983a109d3ee6446686fa1d`. Source text supplied by privileged operator directly from `sudo cat`; exact source file bytes were *not* independently fetched into CI.  
**Review-only four-SHA candidate SHA256:** `7849b1c458c71fce7a6aecc1696cead441a209cb515f191fc5d0fad61a53adcc` (operator-reported, not installed).

## Actual action identity, not a financial release

The installer declares `ACTION='host_action_v2_installer_v1'` and `TARGET='honartik_git_worktree_fixed_v1'`. Its modified Base/Executor/Policy/MCP registration dispatches a fixed helper `honartik-git-worktree-fixed-v1.js` through `systemd-run` and insists its returned result has `release_candidate_ready===true` and `production_deploy===false`.

**This is a registration for a Git worktree preparation action, not a live iTicket payment or production deployment action.** Success must never be reported as completion of SEP/Saman, reseller wallet Confirm/Cancel, SAMFA issuance, Yii2 migrations or public purchase.

## Observed preimage mismatch

| Owner key | Expected by installed helper | Actual observed on production |
| --- | --- | --- |
| base | `de924f7319f3656d788ba5d3f89ef2910bf4b0e3f0b8b074e7cd3a534441d5ea` | `4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406` |
| exec | `6bba46890db31abc8eca7e7681753a4788c46170033a555a1106e05d0a7a66f9` | `410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0` |
| policy | `2fedd70a182aa351e269df95a1b9d829f5a0b18defe8871cb4045106948d711a` | `148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174` |
| mcp | `048e2db190c5548f47967447b3b564eefd0b7203cf6df84beb73c520d481633d` | `bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166` |

The first installer job failed fast with `baseline_drift:base` before live mutation. Operator's later *read-only* memory transform showed all four live preimages PASS, exact SHA-only transform PASS, candidate JS syntax PASS, candidate digest as above. This does **not** demonstrate that the existing hardcoded text anchors in `base()`, `execPatch()`, and `mcp()` match the current owner source, or that generated postimages work.

## Semantic and crash-consistency defects — must fix before any apply

### P0 — Partial atomic renames without rollback

Main path writes candidates and then loops:

```js
for (const k of ['base','exec','policy','mcp']) fs.renameSync(tmp[k], F[k]);
done=true;
```

Catch path restores owners **only if `done` is true**. If rename #2, #3 or #4 fails after earlier rename(s), `done` remains false and earlier Production owner files remain modified. Four separate filesystem renames do not form an all-or-nothing transaction. The recovery path must track every completed mutation individually and roll back in reverse order, including errors *inside* the replacement loop. A durable journal plus crash-recovery logic is necessary for power loss/kill, which JavaScript catch cannot handle.

### P0 — Unverified rollback and recovery gaps

No manifest containing all before/after SHA256, ownership, permissions and transaction status is durably persisted ahead of first Production rename. `*.bak` files are written but not fsync'd or verified before mutation. Rollback overwrites all four owners without verifying the saved backup bytes, and does not verify post-rollback hashes or service health independently. If `restartAll()` fails during rollback, the new error can obscure the initial error and leave a partially recovered control plane. Failure before `done=true` also leaves `*.candidate-...` temp files behind.

### P1 — Failure to preserve full file metadata

Candidate writing uses `fs.writeFileSync(tmp[k], next[k], {mode: fs.statSync(F[k]).mode & 0o777, flag:'wx'})` followed by rename. It preserves only permission bits, **not original UID/GID** (nor additional metadata), and changes live target inode. The rollback path uses a new temp file with the current replacement file's mode; it likewise does not explicitly restore the original UID/GID. Check the existing owner metadata and preserve/apply it deliberately.

### P1 — Current-owner anchor and policy assumptions

The hardcoded `repl()` requires an exact old literal present once. Changing the four `BASELINE` hashes does not update these anchors. Because the current Base/Executor/MCP sources differ in hash, anchor compatibility is **unproven**. A dry-run of actual `base()`, `execPatch()`, `policy()`, and `mcp()` on byte-verified **current** owner sources must succeed in memory *before* staging any write. Policy registration creates `operations['host_action.honartik_git_worktree_fixed_v1']={level:4}` without explicit risk/one-time/second-confirmation fields, so the effective Approval Center policy and typed scope must be independently validated as Level 4 critical before enabling.

### P1 — Service blast radius and stale receipts

`restartAll()` restarts Approval, Base, Executor and `prhm-agent-mcp.service` sequentially with no bounded staged health validation or zero-downtime plan. The current MCP architecture may use alternate blue/green units; exact active unit identity must be read first. The `RESULT` file is not invalidated before a new attempt; `latest.json` can therefore describe an older run. There is no persistent transaction id linking request approval, preimages, candidate digest, backups, startup checks and final receipt.

### P1 — Helper binding is only partial assurance

The helper preimage check is `sha(F.helper)===state.honartik_worktree_helper_sha256`. Validate `state.json` schema/target/status/version and that this hash actually corresponds to the intended reviewed helper. Hash compatibility alone does not attest the helper's implementation or its ability to prepare a safe worktree. Do not infer release readiness or live supplier/financial compatibility.

## Required minimal repair design (source only; requires fresh signed authorization)

1. **Read-only preflight:** capture & validate all exact SHA256 and original UID/GID/mode; verify state.json helper binding; verify current registered scopes and exact service unit names; run the exact patch functions in a *non-privileged isolated, no-side-effect* fixture with current verified owner source copies; ensure syntax/JSON validation, code contract and intended new postimage SHAs. Forbid modifying production owners to match old pins.
2. **Persist before mutate:** use a trusted root-owned fixed, SHA-pinned action with unique run id, exclusive lock, restrictive directories, preimage backups, manifest and `fsync` of contents and directory entries, and verified backup hashes before any owner mutation. Keep secrets out of logs.
3. **Transaction & recovery:** track each applied file (including partial errors), verify its postimage, and implement reverse-order rollback for all prior mutations. Add a durable recovery state for process-kill/reboot, exact preimage checks and independent after-rollback SHA verification. Fail closed if recovery cannot be verified.
4. **Service safety:** verify active unit topology and transactional health, only switch/restart services by separately reviewed service graph with safe dependencies and verifiable rollback.
5. **Approval & release:** bind reviewed source commit and candidate digest `7849b1c4...` **only if same postimage and semantics still hold**; request a **new** one-time signed Level-4 approval with clear intended write scope and rollback. The consumed Level-3 request `e49ab4f9-e5f2-42ab-9da1-581c1533c479` cannot be reused. Reverify live preimages just before apply.
6. **Separate iTicket activation:** this action only registers `honartik_git_worktree_fixed_v1`. iTicket dark deploy and eventual payment enable need separate SHA-bound actions and database/bank/supplier/SAMFA evidence. Do not use Honartik web Staging; disposable isolated DB rehearsal is acceptable. No emails.

## Evidence and explicit gate outcome

- Four-owner source-only review CI: [8/8 PASS](https://github.com/prhmonline/prhm-host-actions/actions/runs/39070778796).
- Syntax/operation-reference synthetic contract CI: [7/7 PASS](https://github.com/prhmonline/prhm-host-actions/actions/runs/39071130467).
- Actual live read-only SHA patch/syntax: **PASS** (operator supplied).
- Full source-semantic compatibility: **NOT PROVEN**.
- Crash-consistent rollback: **FAILED BY SOURCE REVIEW**, must redesign.
- New approval/installation: **NOT REQUESTED / NOT INSTALLED**.
- Production application, DB, bank/provider and email mutations: **NONE**.

**Decision:** Keep Production unchanged. Do not submit the four-SHA candidate to the original installer; rectify P0 partial rollback and transaction logging plus preflight compatibility first.
