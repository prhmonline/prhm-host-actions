# Control Plane approval-policy canonical synchronization — reviewed candidate

**State: Git-only candidate, not registered or installed.** No automatic publication, production file mutation, service reload, role grant, Outbox cancellation, or Telegram send.

## Fixed source and live snapshot

- Approved Control Plane source commit: `68e1fbfe20abe0d2b7bf60a207aac69f2c9cd89e` (after reconciliations PR #10 and PR #11).
- Exact canonical policy Git blob: `7e7d22bee0156e4fa3def84b3739f84e8b614bcd`, bundled byte-for-byte in `leadops-policy-sync-canonical-20261012.json`.
- Live preimage on 2026-10-12 SHA-256 `148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174`, policy version `2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1`.
- Unchanged live root-stage Mediator SHA-256 `26ec21a51e3b0cb5e5aafd8a70531efb84243409557f2af186d16e90b673b3ee`.
- Only target: `/opt/prhm-company-control-plane/config/approval-policy.json`, owner root:root mode 0644. The mediator is observed, never written.

## Allowed transformation

Compare actual policy contents semantically. **All** authorization rules, typed scopes, principal bindings and policy fields must match after ignoring exactly `version` and `deployment_integrity`. Both old and new must have 75 operations, 52 typed scopes, strict default-deny, single-use approvals, frozen scope and Level-4 second confirmation. Canonical policy only advances `version` and adds Git-first `deployment_integrity`. The role-provisioning operation from Draft PR #196 remains absent; this step grants NO NEW operational authority.

The fixed candidate refuses mismatched live sha, canonical Git blob, Mediator sha, changed roles/scopes, missing Git-first flags, extra unreviewed registration, unauthorized signer, missing signed one-time consumed Level-4 request, wrong source Git SHA, unsafe target ownership/mode, symlinks and TOCTOU drift.

## Installer contract

`leadops-policy-sync-candidate-v1.cjs` is **not** a callable production installer or an approval issuer. It exports pure validation and a reviewed transaction primitive. Only an independently authenticated and **registered** Host Action trusted adapter may call `applyPrepared`, after checking and consuming its own signed, one-use Level-4 approval, with verified immutable release commit. That trusted adapter is **not bundled**; this PR by itself cannot deploy or produce a legitimate confirmation request.

At install time, independently compare and read the pinned live policy and mediator under an exclusive lock; take and verify a durable root-owned backup before any write. The adapter must perform a same-directory atomic replacement from the exact bundled canonical policy, with expected old/new SHA pins and root ownership/mode retained; recheck mediator unchanged; trigger the approval-center reload and effective policy health verification; emit a per-request audit record. On any failure after beginning the write, restore old policy SHA and reload old policy before returning. Never reset/revert Git history as a rollback, never alter the unrelated Mediator, and never grant a DB role.

## Evidence and NO-GO

Synthetic GitHub Actions CI tests source SHA/Git blob, exact preimage fixture, policy semantic equivalence, Level-4 signature checks, denied owner drift, no-write failures, successful policy-only application, simulated partial-write/reload/audit failure rollback, and postwrite Mediator TOCTOU rollback. **CI does not prove a live deployment**. A separate signed/typed deployment action, a fresh live preflight, off-device recoverable DB backup and claim-path isolation are still prerequisites to the exact-eight pending LeadOps cancellation in Control Plane Draft PR #7.

Related Control Plane [Issue #5](https://github.com/prhmonline/prhm-company-control-plane/issues/5), merged policy PR #10, merged Mediator PR #11, and Host Actions backup role Draft PR #196.
