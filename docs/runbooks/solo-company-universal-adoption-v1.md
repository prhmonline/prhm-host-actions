# Solo Company: safe existing stateful service adoption — SOURCE ONLY

Status (2026-11-03): **NO-GO for production Universal Installer adoption**. This PR provides an exact non-executable adoption contract, source-only verifier, candidate metadata and tests, not a new registered Installer adapter.

## Live observed baseline

- Host: `prhm-production.prhm.ir`; unit `prhm-solo-company-runtime.service` is active/enabled with `DynamicUser=yes`, `ProtectSystem=strict`, `StateDirectory=prhm-solo-company`.
- Service working directory: `/opt/prhm-solo-company`; immutable release marker `/opt/prhm-solo-company/.release-sha`; SHA `0eb43d72aab3f10db22172c8be4c0411cf22d074`.
- Runtime listens ONLY on `127.0.0.1:8782`; `/health` and `/status` return 200, healthy fresh heartbeat, currently idle dark mode. Data is persistent under `/var/lib/private/prhm-solo-company`.
- The current Universal Installer engine is Python `/usr/local/libexec/deploy-control/universal/current`. Its v1 validator accepts only `static/node/php/compose` repository-backed service adapters and requires public HTTPS health markers tied to revision. Its deploy engine stages candidate releases, switches symlinks and can restart registered units.
- Existing runtime DOES NOT satisfy the v1 contract; using `node`, inventing a public HTTPS route or wiring it as a normal deploy would risk unnecessary restarts/data effects.

## Review-only candidate

`solo-company-universal-existing-service-adoption-v1.js` contains no CLI, I/O, deploy, install or service control. It **only** checks injected observation evidence. `solo-company-universal-adoption.production.candidate.json` is an exact candidate, NOT a file to copy into `/etc/deploy-control/projects`.

Admission requires exact release SHA, active+enabled hardened systemd unit, private loopback-only endpoint, healthy fresh heartbeat, zero queue/retries/failed/completed tasks, worker idle and positively attested persistent state. It fails closed on mismatches. The result is explicitly `READ_ONLY_ADMISSION_PASS_NOT_MANAGED`, never a release registration.

## Trusted actual Installer implementation still required

1. Independently review this PR and PR #232, #60; attest Provider-owned signer, key pin and one-time, operation-specific Level-4 receipt. No self-signed authority.
2. In the official Universal Installer *source tree* implement an explicit `existing_stateful_service` adapter and versioned profile schema; do not weaken the existing v1 Node/HTTPS revision rules. Pinned installation by Root-of-Trust only.
3. The new adapter must distinguish **observe/adopt** from **deploy/upgrade**. Initial admission must NEVER call restart, stop, mutate state, extract release, flip current/candidate symlinks, apply migrations or alter credentials. Report managed=false until registration genuinely succeeds.
4. Future upgrade transactions require exact candidate release identity, private persistent data exclusions, exact service and state ownership, fresh critical approval, same-host/off-host recoverability, verified rollback of binary/unit/links while preserving state and explicit post-rollback health checks.
5. Health must use authenticated trusted host-local loopback, not a newly public endpoint. Require a fixed release marker from installed bytes. Test on isolated systemd fixture with failure injection and crash recovery before an actual production operation.
6. Only after verified signed installation of the new Installer bundle and exact registered profile may live observation and adoption be run. Never treat this source-only PR or CI success as production registration.

## Gates

- Runtime installed and healthy: PASS, dark mode.
- Source-only adoption validation: candidate/test, not installed.
- Provider signed Root registration: NO-GO, separate PR #232.
- Official Universal Installer managed admission: NO-GO until new registered engine and profile.
- No production write, no restart, no DNS/public endpoint change carried out in this PR.
