# Honartik finance: protected app/media preimage and isolated rollback proof

**Scope:** Root-only, exact SHA, offline proof. This is NOT the financial release executor and grants NO production authority.

## Fixed sources and fences
- Live backend: `4ac602e874a128c3328f27f3dab473857512cdbf`; live frontend: `1d8f9c30bda4ab8aab8d87b00e978890aa60efe9`.
- Reviewed candidate: `d1a64e640c9c2cf4788d55566c17728be5813941` (no migration files in source delta).
- Existing root rollback helper exact SHA256 `4f6be075122717a4cb7282bc8e08ebec7609610968cb8b7188d19b55a6c1c8e4`.
- Full Yii migration history remains unresolved and payment wallet/compensation flags remain OFF.

## Procedure
1. Run only from a clean checkout of the reviewed and merged exact full Git SHA on `prhm-production.prhm.ir`, with `REVIEWED_SOURCE_SHA` set; require root.
2. Verify unchanged backend and frontend Git HEADs, clean tracked trees, source delta and both finance flags absent. Capture the active frontend .next build, node_modules, all included media, backend vendor dependencies, .git metadata and configuration into root-only staging via non-dereferencing rsync.
3. Explicit exclusions: backend mutable `runtime/` and `app/runtime/`; frontend obsolete `.next.building.*`, `.next.rollback-*`, `.external-stage-*` plus active `.next/cache`, `.next/trace`, `node_modules/.cache`. Other customer media are included. These exclusions mean the archive is a release-relevant preimage, not an all-files filesystem image.
4. Compare all included files with the unchanged live source using dry-run checksum/ACL/xattr rsync; on transient mismatch, retry the copy at most **twice** and then require a completely clean final checksum check (no allowlist exemptions or skipped media). Archive with numeric owners, ACLs and xattrs; calculate SHA256.
5. Extract with ACL/xattr restoration enabled into another isolated root-only directory; checksum-compare full archived backend/frontend contents with staging before deletion.
6. Use a **disposable cloned Git repository**, checkout candidate onto branch main, call the already-installed pinned rollback helper to return HEAD to the current live backend SHA, and prove main still references the target while the rollback is detached and clean. Production Git refs are never changed.
7. Remove scratch copies and keep only root-private mode 0600 archive and JSON report under `/var/lib/prhm-honartik-finance-preimages/`.

## Host invocation
From a SHA-verified clean checkout, use:
```bash
REVIEWED_SOURCE_SHA='<reviewed 40-hex merged commit>' PYTHONDONTWRITEBYTECODE=1 \
 /usr/bin/python3.11 -B scripts/honartik-finance-preimage-offline-rollback-v1.py
```

## Not proven / publication still blocked
Successful offline tar reconstruction and Git checkout rollback DO NOT verify live Apache/PHP-FPM/Next.js cutover rollback, DB rollback, a fresh DB backup, historical Yii migration status, financial supplier/bank reconciliation, or privileged finance release authorization. A new protected release approval and a separately reviewed fixed-scope root executor are still required. The one-use OIDC *identity* receipt is NOT a release approval. Never bypass routine RISK_PATH or enable wallet flags based on this diagnostic.

Report must always state `finance_release_authorized:false`, `finance_release_executor_installed:false`, `runtime_cutover_rollback_tested:false`, `db_rollback_tested:false`, and `production_modified:false`.

## Real production fail-closed diagnostic

The first actual source-pinned run from PR #283 on 2026-11-11 passed the archive-format smoke test and seven host unit tests, but **stopped before issuing any report** at `source_changed_during_preimage`. A separately reproduced root-only backend copy followed by a full checksum comparison showed `DIFF_TOTAL=0` at rest. The failure therefore appears transient; no persistent mismatch was reproduced and no claim of completed preimage or restored rollback was made. This v2 retains the full checksum requirement while permitting at most two rescans/copy repairs. Production code, wallet switches, DB and Git refs are unchanged.
