# Agent 3 Installer Refresh L4: exact on-disk state SHA repair

**Source-only Git candidate; never auto-installs, never bypasses Agent 3 Approval Center.**

## Confirmed root cause (read-only Production inspection, 2026-10-13)

The pre-existing `control_plane_installer_refresh_l4_binding_repair_preflight_v1` fails with `installer_refresh_l4_state_file_sha_mismatch`. The actual root-owned mode-0600 file `/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js` has SHA-256 `b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e`, and contains exactly one temporary-file creation in `ROOT`.

The reviewed Git source `safeFiles-installer-refresh-l4-binding-repair-surface-v1.js` contains the target `STATE_SCRIPT` that writes the temporary file under `/run` instead. Read-only, in-memory substitution of exactly that one line in the live helper produced SHA-256 `b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb`, exactly the target reviewed by the existing WAHA bridge.

| | Verified SHA-256 |
|---|---|
| Physical helper (preimage) | `b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e` |
| Reviewed helper after ONE-line change | `b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb` |

**Do not just repin the old fingerprint, disable the preflight, or execute the old helper in a looser sandbox.** Those workarounds bypass the intended temporary-file confinement requirement.

## Fixed exact source-only repair

The module `installer-refresh-l4-state-on-disk-sha-repair-v1.cjs` derives both old and new helper *bytes* from the reviewed embedded `STATE_SCRIPT` in the same repository. It insists on both expected full SHA-256 values and exactly one matching temporary-path change; rejects schema/source/target drift. It exposes only pure planning and a transaction primitive. It does not execute any arbitrary shell command, call Approval Center, register the action, or modify Production by itself.

Before any file write, a **separately installed trusted adapter** must verify and consume a fresh one-time Level-4 critical approval bound to the exact action/operation, reviewed release Git SHA, physical target path and both old/new fingerprints. It must then acquire an exclusive lock, refuse symlinks and changed owner/permissions/fingerprint, verify the exact reviewed preimage bytes, take and prove a durable root-owned backup, then atomically replace the single file with root:root mode 0600. It must run the **actual fixed read-only Agent 3 preflight** against the new SHA, log old/new fingerprints and request ID, and roll back to the original SHA on any failed write, preflight or audit.

**Still NO-GO for live execution:** This PR deliberately does not ship or activate a trusted Level-4 installer/registration adapter. A green synthetic contract does not constitute human approval, Production installation or positive live preflight. Do not submit a Level-4 request for a different action and repurpose it for this one. Before a real change, require a separate approved installer registration and a fresh explicit single-use approval.

The repair neither provisions `leadops_backup` nor alters the LeadOps Outbox, Telegram dispatcher or database. Those remain independently gated under `prhm-company-control-plane` Issue #5. The fix may unblock the existing installer-refresh preflight, but does **not** by itself authorize the separate policy-only source from merged Host Actions PR #198.
