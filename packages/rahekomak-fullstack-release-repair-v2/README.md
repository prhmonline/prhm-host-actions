# RahKomak full-stack source-only repair (Issue #143)

This package is **not an installer**. It mirrors the canonical on-server production helper at original SHA256 `d61140507300b4e2fc6650f2fc5e4b769543d9937dd2ff58574827af9c40696f`, observed with clean local app HEAD `13917a36df76c0dfdd75f4a84111ba68391f166e`, and fixes the obsolete smoke assertion (exactly 8 API categories).

The new smoke requires ten known API slug identities, rejects duplicates/malformed output and allows additive future categories.

## Hard blockers BEFORE any real deployment

1. The real canonical application checkout is `/home/prhm/projects/generated/rahekomak`, clean local `main`, but `git remote -v` is empty. The similarly named private GitHub `prhmonline/help` is a separate, archived pilot, **NOT** the canonical Production source. Never force-push local history to `help`, treat the pilot SHA as canonical or silently rewrite Production Git.
2. Legacy `rahekomak_production_deploy_v1` is still registered but unusable: obsolete app SHA bindings and resident executor `ProtectHome=yes` make it fail with ENOENT. Do not weaken ProtectHome or remove it before replacement is proven.
3. The reviewed nine-file Git-only repair candidate in superseded PR #195 remains **uninstalled** and pinned to older app HEAD. A new approval-bound native registration, then separate stage and activation, is necessary. The Level-4 request `279e5825-4197-4e10-b2a1-3e49e8398789` was consumed; never replay.
4. No user approval for a new Level-4 critical install has been consumed by this PR. No Production changes or service restarts.
5. When a complete Git origin for canonical app has been established and reviewed, use an exact app SHA, exact candidate helper Git blob, preflight, backups and strong post-cutover 3-host smoke. Log repo/branch/SHA/destination/UTC time/outcome and rollback if needed.

**PR CI success proves only the source contract, NOT live deployment readiness.**
