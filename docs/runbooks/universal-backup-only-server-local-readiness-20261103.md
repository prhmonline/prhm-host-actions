# Server-local Universal Installer backup-only readiness (NO APPLY)

**Purpose:** No Provider VM-console dependency for **read-only diagnosis** of the
already merged backup-only patch; prepare a truthful, single-command server
handoff. This does **not** create an initial trust authority from an ordinary
root shell. No unrelated `host_action_v2_installer_v1` or staging action may be
repurposed to install this upgrade.

Fixed action: `universal_installer_backup_only_upgrade_v1`.
Expected installed bundle: `47e248686971fd373fd32ebe50f593deae6e98e0196ae7e7021508ecabb3c181`.
Candidate bundle: `77c3615ef73faae847008665b683fe2cf63191faca215f46724097051b6b2c29`.
Candidate archive SHA-256: `c3655739d104721ec8866a3e3762982fe43efacf4d3645dcd58b0bfbe8f0f5ec`.

Run from **reviewed exact Git source** using Node 20+ on the authorized server:

```bash
node --test test-universal-installer-backup-only-server-local-readiness-v1.cjs
node universal-installer-backup-only-server-local-readiness-v1.cjs
```

The second command is read-only and has no runtime arguments, network calls,
file mutation, signer interface, installation interface or approval-token inputs.
Its exit code is 2 for missing prerequisites, 0 only when source registration
looks complete (still **not** proof that a real one-time signed L4 receipt was
issued, consumed or cryptographically validated).

## Verified live baseline at 2026-11-03

- Read-only host session: UID 0, Approval Center and executor services active.
- Installed `backup.py` SHA-256: `6e8b8f65eec3638900f70059ccf7c265fe45010fadd98e0de45f5cdf1e6dcdea` (old).
- Candidate archive digest matches the pinned archive above. Exact-source
  verifier run on real current+candidate: baseline PASS, bundle PASS, only
  `backup.py` changed, AST PASS.
- Existing Approval Center public Ed25519 key and consumed-ledger directory
  exist under `/var/lib/prhm-company-approval` (service-owned). This key is
  **NOT** automatically a Provider initial-bootstrap key.
- Initial provider key
  `/var/lib/prhm-agent-selfmaint-exec/root-of-trust/provider-bootstrap-ed25519-public.pem`
  is absent, and native fixed action/policy/Agent registration is absent.
- Official Host Actions request for the fixed action returned
  `host_action_v2_not_allowed`.
- A superficially similar `host_action_v2_installer_v1` can request Level 3
  but is pinned to a DIFFERENT `honartik_git_worktree_fixed_v1` target.
  Its request **must not** be applied for this Universal upgrade.

## Exactly remaining trust enrollment

1. An independently reviewed server-local enrollment policy must determine
   the legitimate issuer, external authentication method and root-trusted
   pinned key. Reusing the existing Approval Center signer for *initial
   registration* requires **an explicit reviewed policy transition**, not
   implied trust from the mere presence of an Ed25519 key.
2. A separately authorized and authenticated registration operation must
   install exactly the approved source, policy, MCP/API/executor binding and
   signed-receipt verifier with crash-safe four-owner restore and real service
   health/restart evidence. An ordinary SSH/RDC root session, GitHub merge
   or chat approval alone is **not** the initial registration authorization.
3. Re-run the zero-input readiness tool; require every gate to pass.
4. Request a **fresh one-use Level 4** with exact action, old/new bundle SHA
   and cryptographic verification by the live trusted executor.
5. Install through the **existing** Universal Installer, verify new digest,
   full profile health, recovery journal and independent Rollback proof.
6. Release Honartik from a separately approved pinned application SHA.

If step 1's independently trusted signer/approval cannot be established, the
correct final state is `NO-GO`; do not self-sign a replacement token on the
same server as a shortcut. This file makes that limitation explicit so no
future conversation repeats ineffective approval requests.
