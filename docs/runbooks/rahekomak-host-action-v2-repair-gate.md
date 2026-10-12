# RahKomak Release Host Action — repaired source candidate, no Production installation

As of 2026-10-13, canonical GitHub source is **prhmonline/help** at merge commit `184b703729122df73c1a92da081ef09b7e418ed3`. CI web/admin/API and release isolation were all green ([run 38310165011](https://github.com/prhmonline/help/actions/runs/38310165011)).

This candidate repair replaces the old isolated-worker release pin `7f2ea82...` and old helper checksum with:
- Target app source: `prhmonline/help` commit `184b703729122df73c1a92da081ef09b7e418ed3`.
- Exact helper SHA256: `30d3b1a405af7d5f2a84223e0f0b2f9c1ea364526ca83d31df298d62f3e65833` (cross-checked old SHA256 implementation against known historical checksum).
- Immutable 5-artifact bootstrap source commit `a4d2b5dd140f6599c51ba60b0faace5137d40fcb`. Signed consumed Level-4 *registry install* must pin this commit and independently verify five Git blob IDs.
- Four live control-plane preimages remain unchanged and exact from the previous registration plan:
  base `4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406`,
  executor `410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0`,
  MCP `bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166`,
  policy `148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174`.
- Preserve resident service `ProtectHome=yes`. Application access goes through a separate transient worker with `ProtectHome=read-only`; never weaken the resident boundary.
- Existing registered action `rahekomak_production_deploy_v1` has stale pins and is UNSAFE to call. Do not delete it until the new path is independently verified.

## Critical sequence — never skip

1. Review all pinned blob IDs, syntax, node:test regressions, and isolated filesystem rollback simulations in GitHub CI.
2. Find/provision a **trusted, registered, SHA-bound native bootstrap dispatcher** that can call `rahekomak_host_action_repair_registration_v2` with signed, independently approved, one-time Level-4 consumed authorization. The ordinary Host Actions v2 request service does not currently include this registrar. **Do not call any source-only installer directly via SSH or Desktop Commander**.
3. After registry installation and verification of control-plane health, obtain separate Level-4 approvals to stage and then activate the repaired worker. Only assert activation from persisted receipts and live service health (not asynchronous scheduling).
4. Canonical live server checkout is currently still `13917a36df76c0dfdd75f4a84111ba68391f166e`, not the new release target. Use an **authorized independent Git-first checkout/update/cutover**, backing up everything. A worker bound to the new commit intentionally FAILS preflight on the old server HEAD. Do not force-reset the original worktree, and do not claim this candidate enables live deploy yet.
5. Separately approve actual full-stack release of the exact reviewed Git SHA. Verify Web/Admin/API, deploy log repo/branch/SHA/target/time/outcome/rollback, and rollback to last known healthy server version if necessary.

**Proof of code/CI is not proof of installation or release. No Approval Center request is created or consumed here; no Production files changed.**
