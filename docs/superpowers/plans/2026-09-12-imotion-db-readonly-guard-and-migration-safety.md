# iMotion DB Read-Only Guard and Migration Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the emergency iMotion MariaDB writability containment into Git-owned Host Actions, require final DirectAdmin sync to use the lease-aware read-only wrapper, and revoke only the temporary `imotion-migration-node1-20260910` SSH key after verified migration completion.

**Architecture:** Implement one Git-backed package containing the five canonical host payload files and three fixed Level-4 Host Action helpers. `imotion_db_guard_install_v1` reconciles the production hotfix atomically and verifies runtime parity. `imotion_directadmin_final_sync_v1` remains unregistered until read-only discovery identifies one exact current final-sync program path and SHA-256; once bound, it can invoke that fixed program only through `/usr/local/sbin/imotion-db-readonly-window`. `imotion_migration_key_revoke_v1` is separately gated on persisted final-sync success evidence and removes exactly one key identity.

**Tech Stack:** Node.js Host Actions v2, Bash 4+, systemd, MariaDB 10.6 in Docker, Linux auditd, OpenSSH, Git/GitHub.

**Spec:** `docs/superpowers/specs/2026-09-12-imotion-db-readonly-guard-and-migration-safety-design.md`

## Global Constraints

- Canonical repository: `prhmonline/prhm-host-actions`.
- Feature branch: `feature/imotion-db-readonly-guard-v1`.
- Production host identity: `prhm-production.prhm.ir` / private origin `10.71.0.118`.
- MariaDB container: `imotion-db`; expected `@@global.server_id = 1`; expected normal `@@global.read_only = 0`.
- DirectAdmin target: `10.71.0.10` only.
- node1 identity: `server-185-191-76-138`; public `185.191.76.138`; private source toward production `10.71.0.1`.
- Temporary migration key comment: `imotion-migration-node1-20260910`.
- Temporary migration key fingerprint: `SHA256:5rTq+yh+xrQPoeQIVCfHPHDvUnntDdp6IDMD5cDruDs`.
- Temporary migration key source restriction: `from="10.71.0.1"`.
- All three mutation actions are Host Actions v2 Level-4 / `critical` and require literal `CONFIRM_LEVEL_4_CRITICAL`.
- No action accepts arbitrary command, SQL, host, path, service, key material, username, container, database name, or JSON payload.
- Never intentionally set live Production MariaDB `read_only=ON` merely to test guard behavior.
- Never restart MariaDB or Docker merely to test this project.
- Final-sync action must not register until one exact existing migration program has been positively identified and SHA-bound.
- Key revocation must never run automatically and must remain a separate fresh Level-4 action after final-sync success.

---

### Task 1: Create the isolated implementation worktree and establish the baseline

**Files:**
- Existing repo: `/home/prhm/worktrees/prhm-host-actions`
- Create worktree: `/home/prhm/worktrees/prhm-host-actions-imotion-db-readonly-guard-v1`
- Branch: `feature/imotion-db-readonly-guard-v1`

**Interfaces:**
- Consumes: remote branch tip containing the approved spec and this plan.
- Produces: an isolated clean worktree used by every later task.

- [ ] **Step 1: Verify the canonical repo and branch tip**

Run:

```bash
git -c safe.directory=/home/prhm/worktrees/prhm-host-actions \
  -C /home/prhm/worktrees/prhm-host-actions \
  fetch --no-tags origin feature/imotion-db-readonly-guard-v1

git -c safe.directory=/home/prhm/worktrees/prhm-host-actions \
  -C /home/prhm/worktrees/prhm-host-actions \
  rev-parse FETCH_HEAD
```

Expected: one 40-hex commit and no force/update of unrelated branches.

- [ ] **Step 2: Create the linked worktree without touching the dirty DrTarjomeh worktree**

Run:

```bash
git -c safe.directory=/home/prhm/worktrees/prhm-host-actions \
  -C /home/prhm/worktrees/prhm-host-actions \
  worktree add \
  /home/prhm/worktrees/prhm-host-actions-imotion-db-readonly-guard-v1 \
  feature/imotion-db-readonly-guard-v1
```

Expected: the new worktree points to the approved feature branch; the existing `feature/drtarjomeh-security-containment-v1` worktree remains untouched.

- [ ] **Step 3: Verify branch identity and cleanliness**

Run:

```bash
git -C /home/prhm/worktrees/prhm-host-actions-imotion-db-readonly-guard-v1 branch --show-current
git -C /home/prhm/worktrees/prhm-host-actions-imotion-db-readonly-guard-v1 status --porcelain=v1 --untracked-files=all
```

Expected: branch `feature/imotion-db-readonly-guard-v1`; empty status.

- [ ] **Step 4: Run the existing repository tests that establish a clean baseline**

Run:

```bash
cd /home/prhm/worktrees/prhm-host-actions-imotion-db-readonly-guard-v1
node --test test-host-actions-v5-readiness.js
node --test test-v27-park-bazar-delivery.js
```

Expected: both commands exit 0. If either fails, stop before implementation and report the baseline failure.

---

### Task 2: Canonicalize the five production containment payloads with contract tests

**Files:**
- Create: `packages/imotion-db-readonly-guard-v1/imotion-db-writability-guard`
- Create: `packages/imotion-db-readonly-guard-v1/imotion-db-readonly-window`
- Create: `packages/imotion-db-readonly-guard-v1/imotion-db-writability-guard.service`
- Create: `packages/imotion-db-readonly-guard-v1/imotion-db-writability-guard.timer`
- Create: `packages/imotion-db-readonly-guard-v1/imotion-db-forensics.rules`
- Create: `packages/imotion-db-readonly-guard-v1/manifest.json`
- Create: `packages/imotion-db-readonly-guard-v1/test-imotion-db-payloads-v1.js`

**Interfaces:**
- Produces: immutable payload bytes and SHA-256 manifest consumed by `imotion_db_guard_install_v1`.
- The guard uses `/run/imotion-db-readonly-authorized` as the lease path and expects `server_id=1`.
- The wrapper accepts local shell arguments but is never exposed as caller input by a Host Action.

- [ ] **Step 1: Write RED tests for the payload contract**

Create tests that assert all of the following before the payload files exist:

```js
assert.equal(payloads.length, 5);
assert.match(guard, /EXPECTED_SERVER_ID="1"/);
assert.match(guard, /GRACE_SECONDS=10/);
assert.match(guard, /imotion-db-readonly-authorized/);
assert.doesNotMatch(guard, /SET GLOBAL read_only=ON/);
assert.match(window, /SET GLOBAL read_only=ON/);
assert.match(window, /SET GLOBAL read_only=OFF/);
assert.match(window, /trap cleanup EXIT ERR INT TERM HUP/);
assert.match(timer, /OnUnitActiveSec=30s/);
assert.match(audit, /exe=\/usr\/bin\/docker/);
assert.match(audit, /auid=0/);
```

Also assert the manifest lists exact destination paths:

```text
/usr/local/sbin/imotion-db-writability-guard
/usr/local/sbin/imotion-db-readonly-window
/etc/systemd/system/imotion-db-writability-guard.service
/etc/systemd/system/imotion-db-writability-guard.timer
/etc/audit/rules.d/imotion-db-forensics.rules
```

- [ ] **Step 2: Run RED and confirm the failure is caused by missing payloads**

Run:

```bash
node --test packages/imotion-db-readonly-guard-v1/test-imotion-db-payloads-v1.js
```

Expected: FAIL because the canonical payload package does not yet exist.

- [ ] **Step 3: Add the canonical payloads from the verified live hotfix behavior**

Implement the Git copies so they preserve the currently verified contract:

- guard: lock, DB state read, valid-lease bypass, `server_id=1` and no-replica checks, one evidence capture per incident, 10-second recheck, fixed `SET GLOBAL read_only=OFF`, post-recovery verification;
- wrapper: original-state capture, root-owned mode-0600 lease with TTL 30..3600 seconds, lease-before-ON ordering, `EXIT ERR INT TERM HUP` cleanup, original-state restoration and logging;
- oneshot service invoking only `/usr/local/sbin/imotion-db-writability-guard`;
- 30-second timer;
- b64+b32 audit rules for root-login `/usr/bin/docker` execution with key `imotion-db-docker-root`.

The payload source must contain no secret value; DB root password is read only at runtime from `/run/secrets/db_root_password` inside `imotion-db`.

- [ ] **Step 4: Generate and commit fixed SHA-256 values in `manifest.json`**

Run:

```bash
sha256sum \
  packages/imotion-db-readonly-guard-v1/imotion-db-writability-guard \
  packages/imotion-db-readonly-guard-v1/imotion-db-readonly-window \
  packages/imotion-db-readonly-guard-v1/imotion-db-writability-guard.service \
  packages/imotion-db-readonly-guard-v1/imotion-db-writability-guard.timer \
  packages/imotion-db-readonly-guard-v1/imotion-db-forensics.rules
```

Copy the exact results into `manifest.json`; the test recomputes and compares them.

- [ ] **Step 5: Run GREEN verification**

Run:

```bash
bash -n packages/imotion-db-readonly-guard-v1/imotion-db-writability-guard
bash -n packages/imotion-db-readonly-guard-v1/imotion-db-readonly-window
node --test packages/imotion-db-readonly-guard-v1/test-imotion-db-payloads-v1.js
```

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/imotion-db-readonly-guard-v1
git commit -m "feat(imotion): canonicalize DB writability guard payloads"
```

---

### Task 3: Implement `imotion_db_guard_install_v1` with rollback and Level-4 registration

**Files:**
- Create: `packages/imotion-db-readonly-guard-v1/imotion-db-guard-install-v1.js`
- Create: `packages/imotion-db-readonly-guard-v1/test-imotion-db-guard-install-v1.js`
- Create: `bootstrap-host-actions-v28-imotion-db-readonly-guard-v1.js`
- Create or modify the bootstrap contract test for the v28 registration in the same package test file.

**Interfaces:**
- Produces fixed Host Action name: `imotion_db_guard_install_v1`.
- Operation: `host_action.imotion_db_guard_install_v1`.
- Approval: Level 4; `project=control_plane`, `environment=production`, `risk=critical`.
- Consumes only the committed payload package and manifest; accepts no arbitrary action arguments.

- [ ] **Step 1: Write RED tests for fixed scope and rollback**

Tests must prove:

```js
assert.equal(helper.ACTION, 'imotion_db_guard_install_v1');
assert.equal(helper.HOSTNAME, 'prhm-production.prhm.ir');
assert.equal(helper.CONTAINER, 'imotion-db');
assert.equal(helper.EXPECTED_SERVER_ID, '1');
assert.equal(helper.TARGETS.length, 5);
assert.equal(helper.ARBITRARY_COMMAND_INPUT, false);
assert.equal(helper.ARBITRARY_SQL_INPUT, false);
```

Static tests must also require:

- exact payload SHA validation before mutation;
- exact live preimage capture before replacement;
- no target symlinks;
- same-directory atomic writes;
- `bash -n` verification of both scripts;
- `systemctl daemon-reload`, timer enable/start and one guard oneshot run;
- additive audit-rule load only;
- no MariaDB/Docker restart;
- postcondition DB `read_only=0`, `server_id=1`, no slave state;
- Admin bounded non-5xx check;
- injected post-write failure restores exact preimages and prior timer state.

Bootstrap tests must require the Host Actions v2 base/executor/MCP/policy patches to add only this fixed action at Level 4.

- [ ] **Step 2: Run RED**

```bash
node --test packages/imotion-db-readonly-guard-v1/test-imotion-db-guard-install-v1.js
```

Expected: FAIL because helper/bootstrap do not yet exist.

- [ ] **Step 3: Implement the minimal installer helper**

The helper must:

1. verify hostname exactly;
2. verify `imotion-db` is running;
3. verify current DB is writable primary before mutation;
4. verify every payload SHA against `manifest.json`;
5. snapshot all existing target bytes/mode/uid/gid and prior timer state;
6. atomically install only the five fixed targets;
7. syntax-check installed scripts;
8. reload systemd and ensure timer enabled+active;
9. load the two audit rules additively when absent;
10. invoke the guard once while DB is already writable;
11. verify DB and HTTP postconditions;
12. persist sanitized result evidence;
13. rollback exact target preimages and prior timer/audit state on any post-mutation failure.

- [ ] **Step 4: Implement additive bootstrap registration**

`bootstrap-host-actions-v28-imotion-db-readonly-guard-v1.js` must fingerprint the exact live Base/Executor/MCP/Policy preimages before patching and refuse unknown drift. It must install the helper but must not execute Production guard installation during bootstrap.

- [ ] **Step 5: Run GREEN and regression tests**

```bash
node --check packages/imotion-db-readonly-guard-v1/imotion-db-guard-install-v1.js
node --check bootstrap-host-actions-v28-imotion-db-readonly-guard-v1.js
node --test packages/imotion-db-readonly-guard-v1/test-imotion-db-guard-install-v1.js
node --test packages/imotion-db-readonly-guard-v1/test-imotion-db-payloads-v1.js
```

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add \
  packages/imotion-db-readonly-guard-v1/imotion-db-guard-install-v1.js \
  packages/imotion-db-readonly-guard-v1/test-imotion-db-guard-install-v1.js \
  bootstrap-host-actions-v28-imotion-db-readonly-guard-v1.js
git commit -m "feat(imotion): add Level-4 DB guard installer action"
```

---

### Task 4: Resolve the exact current final-sync program or stop fail-closed

**Files:**
- Create: `packages/imotion-db-readonly-guard-v1/final-sync-binding.json` only after a unique candidate is proven.
- Create: `packages/imotion-db-readonly-guard-v1/test-final-sync-binding-v1.js`.

**Interfaces:**
- Produces either one exact immutable binding `{node1_host, production_host, directadmin_target, path, sha256}` or a hard blocker with no final-sync action registration.
- No mutation occurs in this task.

- [ ] **Step 1: Write the binding test first**

The test must fail unless `final-sync-binding.json` exists and contains exactly:

The committed binding JSON must contain the six fixed topology fields below plus two discovery-derived literal fields:

```text
node1_host = server-185-191-76-138
node1_public_ip = 185.191.76.138
node1_private_source = 10.71.0.1
production_host = prhm-production.prhm.ir
production_private_ip = 10.71.0.118
directadmin_target = 10.71.0.10
path = an absolute regular-file path returned by the successful discovery gate
sha256 = the exact 64-character lowercase SHA-256 returned twice for that same file
```

The test must reject symlink paths, non-absolute paths, all-zero SHA, host/IP drift, and any binding whose path/SHA pair is not backed by the two-read discovery evidence. The committed JSON must contain only literal discovered values, never descriptive sentinel strings.

- [ ] **Step 2: Run RED**

```bash
node --test packages/imotion-db-readonly-guard-v1/test-final-sync-binding-v1.js
```

Expected: FAIL because no binding exists.

- [ ] **Step 3: Perform bounded read-only discovery on node1**

Use the existing Agent2 default node1 credential through a fixed read-only discovery surface. Search only migration-owned roots already evidenced for this environment and return only candidate metadata: absolute regular-file path, mode, owner, mtime, SHA-256, and whether the file references the fixed Production `10.71.0.118` and DirectAdmin target `10.71.0.10`. Do not return credentials or file bodies.

Acceptance rule:

- exactly one candidate can be positively tied to the currently intended iMotion final-sync flow;
- its file is regular, not a symlink;
- its SHA-256 is stable across two reads;
- its semantics do not contain a direct unmanaged `SET GLOBAL read_only=ON` path.

If zero or more than one candidate remains, STOP. Do not create `final-sync-binding.json`; do not implement or register `imotion_directadmin_final_sync_v1`.

- [ ] **Step 4: Commit the literal discovered binding only after two-read parity**

Run the binding test again. Expected: PASS with a literal path and literal SHA, no placeholders.

- [ ] **Step 5: Commit**

```bash
git add packages/imotion-db-readonly-guard-v1/final-sync-binding.json packages/imotion-db-readonly-guard-v1/test-final-sync-binding-v1.js
git commit -m "chore(imotion): bind current DirectAdmin final-sync program"
```

---

### Task 5: Implement `imotion_directadmin_final_sync_v1` only after Task 4 is GREEN

**Files:**
- Create: `packages/imotion-db-readonly-guard-v1/imotion-directadmin-final-sync-v1.js`
- Create: `packages/imotion-db-readonly-guard-v1/test-imotion-directadmin-final-sync-v1.js`
- Modify: `bootstrap-host-actions-v28-imotion-db-readonly-guard-v1.js`

**Interfaces:**
- Produces fixed action `imotion_directadmin_final_sync_v1`.
- Consumes `final-sync-binding.json` and the Git payload SHA for `/usr/local/sbin/imotion-db-readonly-window`.
- Persists immutable success evidence for the key-revocation gate.

- [ ] **Step 1: Write RED contract tests**

Tests must prove:

- no command/path/SQL/host inputs exist;
- node1/Production/DirectAdmin identities are exact;
- final-sync program path and SHA come only from `final-sync-binding.json`;
- wrapper path is exactly `/usr/local/sbin/imotion-db-readonly-window`;
- wrapper reason is exactly `directadmin-final-cutover`;
- TTL is fixed, reviewed, and `<=3600`;
- no direct `SET GLOBAL read_only=ON` exists outside the canonical wrapper payload;
- preflight requires DB `read_only=0`, `server_id=1`, no slave state, timer active, no lease, correct temporary migration key identity, reachable `10.71.0.10`, and exact final-sync SHA;
- success requires wrapper exit 0, lease absent, DB writable primary, healthy required containers, Admin non-5xx, target migration verification PASS, and persisted success result;
- wrapped command failure is still final-sync failure even when DB restoration succeeds;
- key revocation is not performed by this action.

- [ ] **Step 2: Run RED**

```bash
node --test packages/imotion-db-readonly-guard-v1/test-imotion-directadmin-final-sync-v1.js
```

Expected: FAIL because action is absent.

- [ ] **Step 3: Implement the fixed final-sync action**

The action may invoke only the literal bound final-sync program. Any wrapper invocation must be server-constructed; caller input cannot supply command arguments. The wrapper owns DB-state cleanup. The action owns migration-level verification and sanitized persisted result evidence.

- [ ] **Step 4: Extend bootstrap registration and Level-4 policy**

Add only `imotion_directadmin_final_sync_v1` with operation `host_action.imotion_directadmin_final_sync_v1`, Level 4, critical risk. If `final-sync-binding.json` is absent or invalid, bootstrap must deliberately omit/refuse this action rather than install a generic fallback.

- [ ] **Step 5: Run GREEN**

```bash
node --check packages/imotion-db-readonly-guard-v1/imotion-directadmin-final-sync-v1.js
node --test packages/imotion-db-readonly-guard-v1/test-imotion-directadmin-final-sync-v1.js
node --test packages/imotion-db-readonly-guard-v1/test-final-sync-binding-v1.js
```

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/imotion-db-readonly-guard-v1/imotion-directadmin-final-sync-v1.js packages/imotion-db-readonly-guard-v1/test-imotion-directadmin-final-sync-v1.js bootstrap-host-actions-v28-imotion-db-readonly-guard-v1.js
git commit -m "feat(imotion): force DirectAdmin final sync through read-only lease wrapper"
```

---

### Task 6: Implement separately gated `imotion_migration_key_revoke_v1`

**Files:**
- Create: `packages/imotion-db-readonly-guard-v1/imotion-migration-key-revoke-v1.js`
- Create: `packages/imotion-db-readonly-guard-v1/test-imotion-migration-key-revoke-v1.js`
- Modify: `bootstrap-host-actions-v28-imotion-db-readonly-guard-v1.js`

**Interfaces:**
- Produces fixed action `imotion_migration_key_revoke_v1`.
- Consumes only the persisted successful result from `imotion_directadmin_final_sync_v1` plus current production health and exact key identity.

- [ ] **Step 1: Write RED tests**

Tests must require:

- exact key comment `imotion-migration-node1-20260910`;
- exact fingerprint `SHA256:5rTq+yh+xrQPoeQIVCfHPHDvUnntDdp6IDMD5cDruDs`;
- exact `from="10.71.0.1"` source restriction;
- exactly one matching key entry before mutation;
- successful current-version final-sync result before mutation;
- current DB writable primary, no lease, no running final-sync action, healthy bounded production checks;
- no removal of older `host-to-production-migration-20260721` or unrelated keys;
- exact authorized_keys preimage capture;
- sibling temp file + fsync + atomic rename;
- exact unrelated fingerprint-set equality after removal;
- injected verification failure restores exact preimage.

- [ ] **Step 2: Run RED**

```bash
node --test packages/imotion-db-readonly-guard-v1/test-imotion-migration-key-revoke-v1.js
```

Expected: FAIL because helper is absent.

- [ ] **Step 3: Implement the exact-match revocation helper**

Never return full public-key material in result evidence. Persist only comment/fingerprint metadata, before/after key counts, health result, and rollback status.

- [ ] **Step 4: Extend bootstrap with the third Level-4 action**

Register operation `host_action.imotion_migration_key_revoke_v1` as Level 4 / critical. Do not chain it automatically after final-sync.

- [ ] **Step 5: Run GREEN**

```bash
node --check packages/imotion-db-readonly-guard-v1/imotion-migration-key-revoke-v1.js
node --test packages/imotion-db-readonly-guard-v1/test-imotion-migration-key-revoke-v1.js
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/imotion-db-readonly-guard-v1/imotion-migration-key-revoke-v1.js packages/imotion-db-readonly-guard-v1/test-imotion-migration-key-revoke-v1.js bootstrap-host-actions-v28-imotion-db-readonly-guard-v1.js
git commit -m "feat(imotion): add gated migration key revocation action"
```

---

### Task 7: Full contract, Git closure, bootstrap install, and production gates

**Files:**
- All files created by Tasks 2-6.

**Interfaces:**
- Produces remote Git parity, registered Host Actions, and production execution requests.
- Production mutation still requires separate fresh Level-4 confirmations.

- [ ] **Step 1: Run the complete local contract suite**

```bash
cd /home/prhm/worktrees/prhm-host-actions-imotion-db-readonly-guard-v1
bash -n packages/imotion-db-readonly-guard-v1/imotion-db-writability-guard
bash -n packages/imotion-db-readonly-guard-v1/imotion-db-readonly-window
node --check packages/imotion-db-readonly-guard-v1/imotion-db-guard-install-v1.js
node --check packages/imotion-db-readonly-guard-v1/imotion-migration-key-revoke-v1.js
node --check bootstrap-host-actions-v28-imotion-db-readonly-guard-v1.js
node --test packages/imotion-db-readonly-guard-v1/test-imotion-db-payloads-v1.js
node --test packages/imotion-db-readonly-guard-v1/test-imotion-db-guard-install-v1.js
node --test packages/imotion-db-readonly-guard-v1/test-imotion-migration-key-revoke-v1.js
```

If Task 4 produced a final-sync binding, additionally run:

```bash
node --check packages/imotion-db-readonly-guard-v1/imotion-directadmin-final-sync-v1.js
node --test packages/imotion-db-readonly-guard-v1/test-final-sync-binding-v1.js
node --test packages/imotion-db-readonly-guard-v1/test-imotion-directadmin-final-sync-v1.js
```

Expected: all applicable commands exit 0.

- [ ] **Step 2: Secret and dangerous-surface scan**

Run:

```bash
grep -RInE 'BEGIN (OPENSSH|RSA|EC) PRIVATE KEY|Authorization:|approval_token\s*[:=]|DB_PASSWORD\s*[:=]' packages/imotion-db-readonly-guard-v1 bootstrap-host-actions-v28-imotion-db-readonly-guard-v1.js
```

Expected: no matches.

Run:

```bash
grep -RInE 'rm -rf|mkfs|DROP DATABASE|DROP TABLE|docker restart|systemctl restart .*mariadb|SET GLOBAL read_only=ON' packages/imotion-db-readonly-guard-v1 bootstrap-host-actions-v28-imotion-db-readonly-guard-v1.js
```

Expected: the only allowed `SET GLOBAL read_only=ON` occurrence is in the canonical `imotion-db-readonly-window` payload; no destructive generic command is present.

- [ ] **Step 3: Verify scoped diff and commit state**

```bash
git status --short
git diff --check
git log --oneline --decorate -10
```

Expected: only this project's files are changed/committed; no unrelated state.

- [ ] **Step 4: Push non-force and verify remote HEAD parity**

```bash
git push origin HEAD:refs/heads/feature/imotion-db-readonly-guard-v1
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git ls-remote origin refs/heads/feature/imotion-db-readonly-guard-v1 | awk '{print $1}')
test "$LOCAL" = "$REMOTE"
```

Expected: equality and no force push.

- [ ] **Step 5: Install only the Host Actions registration/bootstrap after a fixed SHA-bound bootstrap approval**

Bootstrap installation must not execute any of the three Production actions. After bootstrap, rediscover Agent2 schema and verify the action names visible match only the actions whose bindings are complete.

- [ ] **Step 6: Create a fresh Level-4 request for `imotion_db_guard_install_v1`**

Preflight/status must show exact package SHA binding and Production host identity. Stop and request literal `CONFIRM_LEVEL_4_CRITICAL` before apply.

- [ ] **Step 7: Apply guard installer and verify without inducing read-only**

Success evidence must include:

```text
read_only=0
server_id=1
no slave state
timer enabled
timer active
no active lease
installed payload SHA == Git manifest SHA
Admin HTTP non-5xx
```

Do not toggle `read_only=ON` for testing.

- [ ] **Step 8: Execute final-sync only if Task 4 and Task 5 are complete**

Create a separate fresh Level-4 request and stop for explicit `CONFIRM_LEVEL_4_CRITICAL`. After apply, verify the persisted final-sync success gate and DB restoration before moving on.

- [ ] **Step 9: Revoke the migration key only after final-sync success**

Create a third fresh Level-4 request and stop for explicit `CONFIRM_LEVEL_4_CRITICAL`. After apply, verify the exact temporary key is absent, unrelated key fingerprints are unchanged, DB remains writable, no lease remains, and Admin remains non-5xx.

- [ ] **Step 10: Final Git/runtime closure**

Record and compare:

- remote branch HEAD;
- bootstrap/action version identity;
- installed production payload SHA values;
- final-sync binding SHA when present;
- key-revocation result identity;
- current DB and HTTP health.

Do not claim completion unless every applicable verification has fresh evidence.
