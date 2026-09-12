# iMotion DB Read-Only Guard and Migration Safety Design

## Status
Approved by the user with `تایید طراحی` on 2026-09-12.

## Goal
Persist the emergency iMotion MariaDB read-only containment into Git and the PRHM Host Actions control plane, force all future iMotion DirectAdmin final-sync write-freeze operations through the approved lease-aware wrapper, and revoke the temporary migration SSH key only after verified migration completion.

The design must prevent a recurrence of the production outage where MariaDB remained globally read-only after a migration-related operation, while preserving legitimate short read-only windows required for final cutover.

## Current Production Facts
The current iMotion production origin is `prhm-production.prhm.ir` (`10.71.0.118` on the private route). The MariaDB container is fixed as `imotion-db` and currently reports:

- `@@global.read_only = 0`
- `@@global.server_id = 1`
- no active slave/replica state

The new DirectAdmin target is fixed as `10.71.0.10`.

The node1 edge/migration host is `server-185-191-76-138` with public address `185.191.76.138` and private source address `10.71.0.1` toward the production VM.

The temporary production SSH migration key is identified by:

- comment: `imotion-migration-node1-20260910`
- fingerprint: `SHA256:5rTq+yh+xrQPoeQIVCfHPHDvUnntDdp6IDMD5cDruDs`
- source restriction: `from="10.71.0.1"`

The key is temporary and must not be revoked until the final migration/cutover has completed and passed the post-cutover verification gate.

## Existing Emergency Containment
The live production host currently contains four logical containment artifacts, represented by five concrete files:

1. DB writability guard:
   - `/usr/local/sbin/imotion-db-writability-guard`
2. Authorized read-only maintenance wrapper:
   - `/usr/local/sbin/imotion-db-readonly-window`
3. systemd guard bundle:
   - `/etc/systemd/system/imotion-db-writability-guard.service`
   - `/etc/systemd/system/imotion-db-writability-guard.timer`
4. audit rule:
   - `/etc/audit/rules.d/imotion-db-forensics.rules`

The timer is enabled and active. The guard currently checks every 30 seconds. The authorized wrapper uses `/run/imotion-db-readonly-authorized` as its lease and restores the original `read_only` state on `EXIT`, `ERR`, `INT`, `TERM`, and `HUP`.

No implementation or test in this project may intentionally set production MariaDB to `read_only=ON` merely to prove the guard works. Production verification must remain non-destructive.

## Chosen Architecture
Use three independent fixed Host Actions, all registered through the existing Host Actions v2 request/apply model:

1. `imotion_db_guard_install_v1`
2. `imotion_directadmin_final_sync_v1`
3. `imotion_migration_key_revoke_v1`

The actions are separate because installation, final sync, and credential retirement have different preconditions, mutation scopes, rollback behavior, and operator timing.

All three actions are fixed-input actions. None accepts caller-provided command, SQL, host, path, username, key material, IP address, service name, database name, container name, or arbitrary JSON.

All three actions are Level-4/critical production actions and require the existing one-time approval flow plus literal second confirmation `CONFIRM_LEVEL_4_CRITICAL`.

## Repository Layout
The implementation should live together under:

`packages/imotion-db-readonly-guard-v1/`

The package contains the canonical source form of the five host files plus the fixed Host Action helpers and contract tests. The repository-level bootstrap file may remain at repository root to match existing Host Actions conventions.

Canonical payload files:

- `packages/imotion-db-readonly-guard-v1/imotion-db-writability-guard`
- `packages/imotion-db-readonly-guard-v1/imotion-db-readonly-window`
- `packages/imotion-db-readonly-guard-v1/imotion-db-writability-guard.service`
- `packages/imotion-db-readonly-guard-v1/imotion-db-writability-guard.timer`
- `packages/imotion-db-readonly-guard-v1/imotion-db-forensics.rules`

Host Action helpers:

- `packages/imotion-db-readonly-guard-v1/imotion-db-guard-install-v1.js`
- `packages/imotion-db-readonly-guard-v1/imotion-directadmin-final-sync-v1.js`
- `packages/imotion-db-readonly-guard-v1/imotion-migration-key-revoke-v1.js`

Contract test:

- `packages/imotion-db-readonly-guard-v1/test-imotion-db-readonly-guard-v1.js`

Bootstrap:

- `bootstrap-host-actions-v28-imotion-db-readonly-guard-v1.js`

The bootstrap version number may advance if `v28` is already consumed before implementation; the implementation must choose the next free repository sequence rather than overwrite an unrelated bootstrap.

## Action 1: `imotion_db_guard_install_v1`

### Purpose
Install or reconcile the exact Git-backed containment artifacts on `prhm-production.prhm.ir` and verify that the production database remains writable.

### Fixed Target
The action is bound to:

- host identity: `prhm-production.prhm.ir`
- MariaDB container: `imotion-db`
- expected primary `server_id`: `1`
- lease: `/run/imotion-db-readonly-authorized`
- incident marker: `/run/imotion-db-readonly-alerted`
- incident directory: `/var/log/imotion/db-readonly-events`

### Guard Contract
The installed writability guard must:

1. acquire an exclusive lock at `/run/imotion-db-writability-guard.lock`;
2. query `@@global.read_only` and `@@global.server_id` using the root password already mounted inside `imotion-db`;
3. clear the incident marker and exit successfully when `read_only=0`;
4. accept `read_only=1` only when a valid root-owned non-symlink lease exists;
5. validate lease expiry and reject stale or overlong leases;
6. refuse automatic recovery when `server_id != 1`;
7. refuse automatic recovery when slave/replica state is present;
8. capture bounded forensic evidence once per continuous unauthorized incident;
9. wait exactly 10 seconds before recovery;
10. re-check for a newly created valid lease before recovery;
11. re-check `read_only`, `server_id`, and replication state after grace;
12. execute only fixed `SET GLOBAL read_only=OFF` when the unauthorized state still exists and all primary-role checks remain valid;
13. verify `read_only=0` after recovery;
14. persist a critical journal event for both failed and successful recovery outcomes.

The guard must never execute `SET GLOBAL read_only=ON`.

### Maintenance Wrapper Contract
The installed `imotion-db-readonly-window` must:

1. accept a local reason, bounded TTL from 30 through 3600 seconds, and a command after `--`;
2. acquire `/run/imotion-db-readonly-window.lock`;
3. capture the original `@@global.read_only` state before mutation;
4. create the root-owned mode-0600 lease before enabling read-only;
5. store `pid`, `started_epoch`, `expires_epoch`, `original_read_only`, and sanitized `reason` in the lease;
6. set `read_only=ON` only after the lease exists;
7. verify the state became `1` before starting the wrapped command;
8. restore the original state if the original state was writable;
9. remove the lease during cleanup;
10. execute cleanup on `EXIT`, `ERR`, `INT`, `TERM`, and `HUP`;
11. journal open/close events including final state and wrapped command return code.

The wrapper remains a root-local operational primitive. The public Host Action surface must never expose its command parameter to callers.

### systemd Contract
The service and timer must remain fixed:

- oneshot service invoking only `/usr/local/sbin/imotion-db-writability-guard`;
- timer cadence of 30 seconds using `OnBootSec=30s` and `OnUnitActiveSec=30s`;
- timer enabled and active after install;
- service expected to be inactive/dead between successful oneshot runs;
- no MariaDB or Docker restart is allowed as part of normal installation.

### Audit Contract
The persistent audit rules must capture root-login executions of `/usr/bin/docker` without recording the systemd guard's own recurring Docker calls. The approved rules are the `b64` and `b32` `execve` rules with `exe=/usr/bin/docker`, `auid=0`, and key `imotion-db-docker-root`.

The installer must load the rules using the host's supported audit rule loader without disabling or replacing unrelated audit rules.

### Install Preflight
Before mutation the action must verify:

1. host identity is exact;
2. Docker is available and `imotion-db` is running;
3. current database state is `read_only=0`, `server_id=1`, and not a slave/replica;
4. every existing target path is either absent, already equal to the desired SHA, or equal to an explicitly approved preimage SHA captured from the emergency hotfix;
5. no target path is a symlink;
6. desired shell scripts pass `bash -n` from repository payloads before installation;
7. desired systemd units and audit rule payload hashes match the fixed package manifest;
8. current timer enable/active state is captured for rollback;
9. current live audit rules are captured in bounded form for verification, not wholesale replacement.

Any unknown drift fails closed before first mutation.

### Install Apply Sequence

1. acquire an action-specific install lock;
2. create timestamped restrictive backups of every existing target file;
3. record absent targets separately so rollback can remove only files created by this action;
4. atomically install the five desired files with fixed modes;
5. run `bash -n` on both installed scripts;
6. run `systemctl daemon-reload`;
7. enable and start the timer;
8. load only the two fixed audit rules additively if not already live;
9. run the guard once while the DB is already writable;
10. verify `read_only=0`, `server_id=1`, no slave state, timer enabled/active, service last result success, and no active maintenance lease;
11. verify iMotion Admin returns a bounded non-5xx response, with the normal login redirect accepted;
12. persist a sanitized result containing before/after SHA values, timer state, database state, HTTP status, and rollback status.

### Install Rollback
After first mutation, any failed postcondition triggers rollback. Rollback restores exact file preimages, removes only newly created files, restores prior timer enable/active state, reloads systemd, and reloads the audit rules from the restored persistent file state using additive/removal operations limited to the action's own key.

Rollback must never restart MariaDB.

## Action 2: `imotion_directadmin_final_sync_v1`

### Purpose
Perform the final DirectAdmin migration sync through the authorized read-only wrapper so an interrupted or failed migration cannot leave production MariaDB read-only.

### Fixed Topology
The action is bound to:

- orchestrator/node1: `server-185-191-76-138`
- node1 public address: `185.191.76.138`
- node1 private source toward production: `10.71.0.1`
- production source/origin: `10.71.0.118`
- DirectAdmin target: `10.71.0.10`
- production wrapper: `/usr/local/sbin/imotion-db-readonly-window`
- production lease: `/run/imotion-db-readonly-authorized`
- fixed reason: `directadmin-final-cutover`

### No Generic Migration Shell
The public action accepts no command and may not forward a caller-provided shell fragment to node1 or production.

Implementation must bind the exact final-sync program/script identity after discovery of the currently intended migration program. The helper must include its absolute fixed path and SHA-256. If the existing migration implementation cannot be positively identified and SHA-bound, this action remains uninstalled and fails closed; no generic replacement command is permitted.

### Final-Sync Preconditions
Before enabling read-only the action must verify:

1. node1 identity and private routing are exact;
2. production host identity is exact;
3. DirectAdmin target `10.71.0.10` is reachable through the approved fixed path;
4. production wrapper exists, is a regular file, and matches the Git-backed expected SHA;
5. production guard timer is enabled and active;
6. production DB is currently writable and primary: `read_only=0`, `server_id=1`, no slave state;
7. no maintenance lease is active;
8. the fixed final-sync program exists as a regular non-symlink file and matches its expected SHA;
9. the temporary migration key still matches the approved comment/fingerprint/source restriction if the final-sync transport still requires it;
10. source and target migration state passes the fixed pre-cutover consistency checks implemented for this release.

### Final-Sync Execution
The action invokes the fixed final-sync operation only through the production wrapper. The wrapper reason is fixed as `directadmin-final-cutover` and the TTL is fixed by the action to a reviewed value not exceeding 3600 seconds.

The action must not contain any direct `SET GLOBAL read_only=ON` path outside the wrapper.

The wrapper owns DB-state cleanup. The outer action owns migration-level result persistence and post-cutover validation.

### Final-Sync Success Gate
Success requires all of:

- wrapped final-sync exits 0;
- wrapper cleanup has completed;
- lease is absent;
- production MariaDB is `read_only=0`;
- production `server_id=1` and no slave state remains;
- iMotion containers required for service are healthy;
- production Admin returns a non-5xx response;
- DirectAdmin target verification passes the fixed migration acceptance checks;
- a sanitized immutable success result is persisted for the subsequent key-revocation gate.

A wrapped command failure is a migration failure even when DB cleanup succeeds.

### Final-Sync Failure
Failure must preserve the wrapper's restored database state and persist evidence distinguishing:

- preflight refusal;
- final-sync command failure with DB successfully restored;
- DB restore verification failure;
- post-cutover application verification failure;
- target verification failure.

The action must never claim migration success solely because `read_only` returned to `0`.

## Action 3: `imotion_migration_key_revoke_v1`

### Purpose
Retire only the temporary migration SSH key after the migration is already proven complete.

### Fixed Key Identity
The action targets only one `authorized_keys` entry whose effective identity satisfies all of:

- comment exactly `imotion-migration-node1-20260910`;
- fingerprint exactly `SHA256:5rTq+yh+xrQPoeQIVCfHPHDvUnntDdp6IDMD5cDruDs`;
- source restriction exactly `from="10.71.0.1"`;
- restricted-key semantics remain present before removal.

The action must not remove any other key, including the older `host-to-production-migration-20260721` key. Review or retirement of that older key is a separate future action.

### Revocation Gate
Revocation fails closed unless all of the following are true:

1. the persisted `imotion_directadmin_final_sync_v1` result exists and is successful;
2. its result identity and action version match the currently installed fixed final-sync action;
3. post-cutover production health evidence is still valid;
4. production DB is currently `read_only=0`, `server_id=1`, and not a slave;
5. no active maintenance lease exists;
6. no final-sync action is currently running;
7. the target key appears exactly once and matches the fixed fingerprint/comment/source restriction.

Revocation is never automatic. It requires a separate fresh Level-4 request and explicit operator confirmation after final-sync success.

### Revocation Apply and Rollback
The action must:

1. capture the exact `authorized_keys` preimage with restrictive permissions;
2. write a sibling temporary file containing every original line except the one exact approved key;
3. preserve owner, group, and mode;
4. fsync and atomically rename;
5. verify the approved fingerprint/comment is absent;
6. verify unrelated key count and fingerprints are unchanged;
7. verify a bounded production health check remains good;
8. persist a sanitized result that never exposes public-key material beyond the approved fingerprint/comment metadata.

If any verification fails after mutation, restore the exact `authorized_keys` preimage atomically and verify the restored fingerprint set before reporting rollback success.

## Approval and Control-Plane Registration
All three actions use the existing Host Actions v2 request/apply path:

`host_action_v2_request` -> explicit `CONFIRM_LEVEL_4_CRITICAL` -> `host_action_v2_apply`

The bootstrap must add the three actions to the currently live base server, executor, MCP schema, and approval policy only after fingerprinting the exact live baselines. Historical repository runtime snapshots must not overwrite newer live runtime files.

Each policy entry is Level 4 with:

- principal: `mohammad`
- role: `mcp-operator`
- environment: `production`
- risk: `critical`
- project: `control_plane`

Existing request expiry, signed binding, one-time consumption, replay protection, and result persistence remain unchanged.

## Git-First and Runtime Parity
The repository is the authoritative source. Production hotfix files must not remain a permanent configuration island.

Required closure:

1. canonical payloads committed to `prhmonline/prhm-host-actions`;
2. contract tests committed in the same branch;
3. bootstrap committed and pushed non-force;
4. remote branch HEAD verified equal to the intended commit;
5. bootstrap installs only SHA-bound artifacts from the reviewed commit;
6. installed production file SHA values equal the repository package manifest;
7. Host Actions runtime registration reflects the same committed action version;
8. future rebuild/reprovision uses the Git-backed installer rather than recreating the emergency files manually.

## TDD RED Matrix
Before implementation code is added, failing tests must prove the missing behavior for:

- all five canonical payload files are required;
- payload manifest SHA mismatch rejects install;
- wrong production hostname rejects install;
- unexpected `server_id` rejects install;
- slave/replica state rejects auto-heal permission;
- guard contains no `SET GLOBAL read_only=ON`;
- wrapper creates the lease before enabling read-only;
- wrapper restores original writable state on wrapped-command failure;
- final-sync action exposes no arbitrary command or SQL input;
- final-sync action contains no direct read-only setter outside the wrapper path;
- unknown final-sync program SHA rejects before read-only mutation;
- key revoke rejects without successful final-sync evidence;
- key revoke rejects zero, duplicate, or mismatched key identities;
- key revoke preserves unrelated key fingerprints;
- each action is Level 4;
- apply without fresh Level-4 confirmation is rejected;
- replay of a consumed request is rejected;
- injected post-install verification failure exercises exact artifact rollback;
- injected key-revoke post-write failure restores exact `authorized_keys` preimage.

## TDD GREEN Matrix
Passing tests must prove:

- desired payload hashes are fixed and reproducible;
- installer is idempotent for exact desired state;
- unknown drift fails closed;
- service/timer state is restored on rollback;
- guard can only auto-heal the fixed primary role;
- authorized leases suppress guard recovery;
- stale leases do not suppress recovery;
- final-sync can invoke only the fixed migration program through the wrapper;
- wrapper return code is preserved as migration result;
- DB restore verification is mandatory after wrapped failure;
- key revoke is separately approved and post-migration only;
- key removal is exact-match and unrelated keys are unchanged;
- no test intentionally toggles live production read-only state;
- no private key, DB password, approval token, Authorization header, or secret value exists in repository source or test fixtures.

## Production Verification Gates
### Guard install
Production apply is successful only when:

- installed artifact SHAs equal the committed manifest;
- both shell scripts pass `bash -n`;
- timer is enabled and active;
- last manual guard oneshot exits 0 while DB is already writable;
- DB remains `read_only=0`, `server_id=1`, no slave state;
- no active maintenance lease exists;
- iMotion Admin returns non-5xx;
- unrelated Docker services are not restarted.

### Final sync
Production migration success requires the full final-sync success gate defined above. No deliberate outage test is permitted.

### Key revoke
Revocation success requires exact key removal plus unchanged unrelated key fingerprint set and healthy production after the change.

## Rollback Boundaries
Rollback remains action-local:

- guard installer rolls back guard/audit/systemd artifacts and their prior service state;
- final-sync relies on the wrapper to restore DB state and does not attempt to undo successfully transferred business data with an unsafe generic reverse sync;
- key revoke restores only the exact `authorized_keys` preimage if its own verification fails.

No action may perform a whole-host rollback, MariaDB restart, Docker restart, unrelated service restart, DNS change, or destructive database restore.

## Explicit Non-Goals
This project does not:

- prove the historical exact actor that first enabled MariaDB read-only;
- revoke `host-to-production-migration-20260721`;
- change application business logic;
- migrate unrelated sites;
- change DNS or TLS;
- change MariaDB startup configuration to force `read_only=OFF`;
- enable permanent MariaDB general logging;
- restart MariaDB merely for testing;
- intentionally place production into read-only state for a synthetic auto-heal test;
- expose a generic SSH, shell, rsync, SQL, Docker, or file-write Host Action.

## Success Criteria
The project is complete when:

1. the containment artifacts are canonical Git-owned assets;
2. `imotion_db_guard_install_v1` is registered, Level-4 protected, installed, and runtime SHA parity is verified;
3. `imotion_directadmin_final_sync_v1` can invoke only the discovered SHA-bound final-sync implementation through `imotion-db-readonly-window`;
4. a failed or interrupted final-sync cannot leave the database read-only without the wrapper attempting and verifying restoration;
5. unauthorized future `read_only=ON` state remains covered by the installed guard and forensic capture;
6. the temporary migration key remains present until final-sync success, then can be revoked only by a separate Level-4 action;
7. after revocation, unrelated SSH keys and production health are unchanged;
8. no production verification step intentionally re-creates the outage condition.
