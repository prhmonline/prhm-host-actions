# RahKomak Host Action #143 — v2 source-only rebase and release gate

This copy of the reviewed PR #146 repair candidate is based on current main without rewriting its Git history. **Do not interpret merge, CI PASS, or staging as authorization for a Production deploy.**

## Verified 2026-10-12

- Live resident executor SHA-256: `410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0` with `ProtectHome=yes`; old in-process `lstatSync` remains installed.
- Original Level-4 request `279e5825-4197-4e10-b2a1-3e49e8398789` failed and was consumed; **NEVER replay**.
- RahKomak current clean main is `13917a36df76c0dfdd75f4a84111ba68391f166e`, while this existing full-stack worker is still pinned to `7f2ea82b0865bb64c8adbc3192e8547fe4f43c25`. It must fail closed on this mismatch.
- Application helper checksum `d61140507300b4e2fc6650f2fc5e4b769543d9937dd2ff58574827af9c40696f`; its smoke contract requires **8** API categories, but live `/v1/categories` returns **10**. Full deploy is intentionally BLOCKED even if isolated-worker tests pass.
- Live web homepage/admin/API respond; live public page JavaScript contains hotline `02154467000`. Website content delivery is separate from repairing full-stack Host Action.

## Mandatory path to the production executor repair

1. Validate this source-only candidate and all regression tests on main-derived branch.
2. Engineer and test a **trusted, signed, Git-SHA-bound bootstrap transaction** for fixed registry source surfaces, five artifact blobs, backup/rollback, strict permission and systemd compatibility. No generic shell or arbitrary path.
3. Install registry only after a fresh, **separate** Level-4 approval. Capture preimage and postimage hashes, PID/service health, and persistent receipt. The existing `host_action_v2_installer_v1` is pinned to an unrelated Honartik action; do not repurpose.
4. Run a fresh Level-4 **stage-only** action, verify receipt, then distinct Level-4 activation approval; do not claim success from systemd scheduling alone.
5. Separately update and validate the full-stack application release contract for 10 categories and clean current HEAD **in the application's canonical Git repository**, with exact helper SHA. Until then block all full-stack deployments from v2.
6. Only after all gates pass, fresh Level-4 Production release, 3-host smoke, actual hotline rendering, Logger metadata, and rollback readiness.

**Current classification: source-only; Production executor repair NOT INSTALLED; full-stack Production deployment NOT APPROVED.**
