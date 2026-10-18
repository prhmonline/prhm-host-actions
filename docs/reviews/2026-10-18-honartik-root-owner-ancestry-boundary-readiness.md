# Honartik control-plane Root owners: ancestry and descriptor readiness gate

**Scope:** read-only, fixed four-owner preflight of proposed privileged install.  
**Status:** [16/16 GitHub fixture tests PASS](https://github.com/prhmonline/prhm-host-actions/actions/runs/39082026725); **real owner-parent trust NOT YET ATTESTED**.

## Context

Previous operator checks on `prhm-production` confirmed:
- SHA-256 of four original owners and helper, and prospective in-memory Base/Exec/MCP output;
- proposed MCP ESM syntax and static critical L4 scope;
- static global Level4 fail-closed one-time approval schema 12/12, with a **new** prospective policy SHA `9a2c47db59211a638976ee181e8a5b246c79f082371d82a7396c6a07f646faa7`.

No root owner has been replaced, and the old privileged root installer is unsafe because it can leave an unrolled-back partial multi-file rename.

## New development gate

`honartik-iticket-root-four-owner-production-readiness-v1.cjs` (source commit `fbf777727653ba991be0c1ec9966c63f4eb63514`) is **read-only**, has fixed canonical paths and old/new SHA pins, and never executes an install, approval, restart, database or deployment action.

The readiness check:
1. Checks each path ancestor from `/` through the target's directory: no symlinks; directories must be owned by root and not group-/world-writable. This is a conservative root-trust policy, **not** a claim the current server complies.
2. Checks root-owned regular target with exactly one hard link and without group-/world-write.
3. Opens the file using `O_NOFOLLOW | O_RDONLY` and compares descriptor device/inode, owner UID/GID, mode and link count with the observed path; detects modifications during the descriptor read.
4. Matches pinned original SHA-256 and produces the **hardened** policy candidate in memory, rather than the prior Level4-only candidate.
5. Checks the four prospective candidate SHA values; compiles Base and Exec syntax, and optionally compiles MCP in syntax-only ESM VM mode.
6. Always reports `INSTALL_AUTHORIZED=NO`, `SIGNED_ROOT_ADAPTER_READY=NO`, `EFFECTIVE_L4_ISSUER=NOT_ATTESTED`, and `PRODUCTION_MUTATION=NO`.

The target `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js` is specially sensitive to an untrusted `/home/agent` ancestor. If `/home/agent` is non-root-owned or group/world-writable, the conservative root-trust preflight **must block** and root installer design must resolve that trust boundary. Do not blindly chown a user's home directory or relax checks.

## Tests and limitations

[Run 39082026725](https://github.com/prhmonline/prhm-host-actions/actions/runs/39082026725): **16/16 PASS** after fixing synthetic path coverage in the test fixture. Covers symlink ancestors, writable/non-root ancestors, noncanonical path, missing IO, hardlinked or non-root-owned target, TOCTOU mismatch, spoofed SHA, symlink `O_NOFOLLOW`, immutable mappings and absence of privileged mutation APIs.

**CI does not contain the live root owner bytes**, so tests deliberately cannot yield positive real on-host readiness. The existing previously SHA-pinned on-host CLI is preserved, but this new source is not yet deployed to the host.

This read-only gate does not solve:
- Single-use signed critical L4 approval enforcement for the *exact* prospective action, including expiry/replay and second confirmation.
- A production-qualified privileged adapter with secure journal location, cross-service exclusive kernel lock held across commit/recovery, backup restores and health/restart.
- Installation/registration of the intentionally inert worktree action handler.
- Honartik's separate iTicket checkout, wallet, bank/SEP, financial migrations and SAMFA acceptance.

**No new approval requested or consumed; no Production, server/root owner, bank, database, email or staging mutation.**
