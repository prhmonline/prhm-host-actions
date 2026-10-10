# PRHM Fast Delivery — shared transaction coordinator v1

## Status / execution boundary

- Source only. No production mutation or daemon installation is part of this commit.
- The 22 project roots and stack labels come from the established fast-delivery-gate v1.
- The CLI exposes **only** a read-only plan (project ID + 40-hex SHA); there is no apply interface.
- coordinate() is a library for a future **trusted, registered native host-action entrypoint**, not an authorization mechanism by itself.
- **Do not** directly expose this function to an untrusted MCP, HTTP, CLI, or generic shell endpoint.
- An action name in the inventory is not evidence that an adapter is registered or operational.

## Safe shared pipeline

1. Check allowlisted project, canonical root, clean tracked/untracked Git state, branch and pinned HEAD.
2. Resolve only a trusted, code-registered fixed adapter, with fixed action identity, registration SHA and L3/L4 approval class.
3. Adapter produces a baseline SHA-256 and proves all preflight conditions.
4. Run project-specific tests and isolated build without changing live output.
5. A native Approval Center implementation verifies and **atomically consumes** a signed, unexpired, single-use approval bound to exact project, commit, action, root, adapter registration SHA and risk level.
6. Recheck Git identity after tests/build and approval.
7. Save a durable deploy-starting receipt before cutover.
8. Execute only the adapter's allowlisted deployment. Require deployed SHA evidence matching requested commit.
9. Check application health. Persist a durable deployed receipt.
10. On any failure after entering deploy, invoke rollback and verify exact baseline SHA and restored service health. Record verified or unverified rollback, never silently claim success.

Each trusted adapter must enforce a per-target durable lock (including cross-process concurrency), fixed file/service/DB scope, immutable SHA-pinned source, timeouts, bounded logs and backup retention. For DB migrations or operations that cannot reliably roll back, the adapter must have a separate approved safety design; do not onboard them via the static-web adapter.

## Native integration outstanding

The coordinator **does not currently have** a production adapter registry, native Approval Center consumeExact integration, durable release logger, or registered Agent 3 orchestration Host Action. No generalized production deployment is enabled by this commit. A trusted native adapter must implement preflight, test, build, deploy, smoke, rollback and return checked proof objects; live bootstrap requires an independently authorized critical change.

Existing RahKomak has its separate web-only SHA-bound release script; do not replace it with rahekomak_production_deploy_v1, which can affect API/database/Apache outside its intended web-only scope. Existing Shifa/iMotion/etc adapter labels in the inventory are declarations, not proof of shared-coordinator activation.

## Smoke usage (read-only)

Run the coordinator script with arguments --plan rahekomak --sha and an exact 40-character commit hash.

Tests: node --test test-prhm-fast-delivery-gate-v1.cjs test-prhm-fast-delivery-coordinator-v1.cjs

### DONE definition for **this source milestone**

- Git commit with new coordinator, tests and safety contract.
- All tests pass, no new privileged entrypoint.
- Nothing in production changes.
- Real adapter registration and cross-project rollout stay open, tracked separately.
