# DrTarjomeh Security Release Deploy v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed Level-4 Host Action that creates a rollback-safe DrTarjomeh security hot-release from the current production artifact, installs the approved credential-remediation payload, binds protected runtime environment values, atomically cuts over, and rolls back on failure.

**Architecture:** Build one SHA-bound Host Actions v2 bootstrap plus one fixed no-input deployment helper. The helper clones the currently approved release into a sibling release, overlays only the approved security payload from DrTarjomeh commit `f22b1d17801239f7539f84e5aa8b91250c87dc58`, creates a protected environment file without exposing values, runs all pre-cutover gates, switches the release pointer atomically, performs one fixed public smoke check, and restores the previous release/environment on failure. Registration is additive against the live Agent 3 baseline and must never overwrite concurrent Titan or other control-plane changes.

**Tech Stack:** Node.js (`prhm-node`), PHP 8.3 CLI, Yii2 legacy runtime, systemd transient units, existing PRHM Host Actions v2 approval/control-plane, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-28-drtarjomeh-security-release-deploy-v1-design.md`

## Global Constraints

- Fixed action: `drtarjomeh_security_release_deploy_v1`.
- Fixed operation: `host_action.drtarjomeh_security_release_deploy_v1`.
- Fixed remediation commit: `f22b1d17801239f7539f84e5aa8b91250c87dc58`.
- Required current production release: `20260805-011747-672d32f490bd`.
- Production pointer: `/home/drtarjomeh/domains/drtarjomeh.ir/public_html`.
- Releases root: `/home/drtarjomeh/domains/drtarjomeh.ir/releases`.
- Protected env: `/etc/drtarjomeh/production.env`, regular non-symlink, mode `0600`.
- Fixed post-cutover HTTP smoke: host `drtarjomeh.ir`, path `/`, accepted status `200..399`, body must not contain `Internal Server Error`.
- Level 4 / critical, second confirmation required, one-time request required.
- No arbitrary command, path, revision, URL, SQL, environment content, or credential input.
- No database write, provider credential rotation, DNS/TLS/Apache/PHP-FPM/package mutation, or unrelated application feature deployment.
- No in-place edits to the live release.
- No secret value may appear in stdout, stderr, journal, result JSON, test fixture output, or MCP responses.
- Mail remains fail-closed to file transport; SMS remains disabled; Slack remains disabled until later provider-specific rotation.
- Every post-mutation failure must attempt automatic rollback and separately report rollback failure.
- Before control-plane installation, re-read the four live Agent 3 control-plane SHA-256 values. Any drift from the development baseline, including changes made by the parallel Titan work, requires re-pinning and rerunning tests; never restore historical control-plane bytes.

## Review Focus

- **Parallel Agent 3/Titan baseline drift:** installation must fail before writes when any pinned control-plane SHA differs; the implementer must re-pin against the latest live additive state and preserve all existing actions.
- **Unexpected protected-env state:** an existing symlink, unknown preimage, unsafe mode, or unexpected owner must fail closed rather than be overwritten.
- **Runtime readability of `0600` env:** candidate verification must prove the actual trusted application runtime UID/GID can read the env file before cutover.
- **Failure after symlink cutover:** tests must force a post-cutover smoke failure and prove both the old release pointer and previous env state are restored and re-verified.
- **Secret leakage through errors/results:** fixture secrets must never appear in serialized success/failure evidence, thrown error messages, or captured process output.

---

### Task 1: Freeze the Approved Security Payload and Production Preconditions

**Files:**
- Create: `bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js`
- Create: `test-v29-drtarjomeh-security-release-deploy.js`

**Interfaces:**
- Produces constants `ACTION`, `OPERATION`, `TARGET_COMMIT`, `EXPECTED_RELEASE`, `PRODUCTION_POINTER`, `RELEASES_ROOT`, `ENV_PATH`, immutable `PAYLOAD` / `PREIMAGES`, and fixed `SMOKE`.
- `PAYLOAD` maps each approved production payload path to exact post-overlay SHA-256 and file mode.
- `PREIMAGES` maps each target path in the expected current release to exact source SHA-256 or explicit `absent` for new files.
- `SMOKE` is exactly `{host:'drtarjomeh.ir', path:'/', status_min:200, status_max:399, forbidden_body:'Internal Server Error'}`.

`PAYLOAD` must contain exactly these 24 paths:

```text
api/config/main-local.php
api/config/web.php
api/web/index.php
backend/web/index.php
common/components/DisabledSmsService.php
common/config/base.php
common/config/base_env.php
common/config/env/dev.php
common/config/env/dev_m.php
common/config/env/devmp.php
common/config/env/drtarjomeh-ir.php
common/config/env/prod.php
common/config/load-environment.php
common/config/params.php
console/config/main.php
core/helpers/sms/webservice/mediana.php
environments/prod/yii
frontend/web/index.php
panel/web/index.php
scripts/probe-runtime-bootstrap.php
scripts/test-environment-loader.php
site_configs/drtarjomeh-ir.php
translator/web/index.php
yii
```

- [ ] **Step 1: Write the failing payload contract test**

Assert `ACTION`, `OPERATION`, `TARGET_COMMIT`, and `EXPECTED_RELEASE` equal the fixed values above. Assert `PAYLOAD` equals the 24-path list above in set membership and explicitly excludes `.env.production.example`, `.github/workflows/secret-scan.yml`, and `scripts/scan-tracked-secrets.py`. Assert no payload path is absolute or contains `..`. Assert `SMOKE` equals the fixed root contract above.

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `node --test test-v29-drtarjomeh-security-release-deploy.js`
Expected: FAIL because the v29 bootstrap/manifest does not exist yet.

- [ ] **Step 3: Read approved commit file bytes and current production preimages**

Use GitHub at commit `f22b1d17801239f7539f84e5aa8b91250c87dc58` for target bytes and approved Agent read-only paths for current release bytes. Record exact SHA-256 values only; do not copy real secret values into the Host Actions repository or plan.

- [ ] **Step 4: Implement immutable manifests and preflight identity checks**

Add `assertFixedPayload()` and `assertExpectedRelease(rootRealpath)` helpers. Preflight must reject unexpected release identity, unknown preimage, missing expected regular file, unexpected existing file for an `absent` preimage, symlinks, or payload destination escaping the candidate release.

- [ ] **Step 5: Add Review Focus tests for unknown preimage and unsafe paths**

Fixture tests must assert that a one-byte preimage change, a symlink payload target, absolute path, and `../` path all fail before any candidate/env mutation.

- [ ] **Step 6: Run tests**

Run: `node --test test-v29-drtarjomeh-security-release-deploy.js`
Expected: payload/preimage tests PASS.

- [ ] **Step 7: Commit**

```bash
git add bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js test-v29-drtarjomeh-security-release-deploy.js
git commit -m "test: pin DrTarjomeh security release payload"
```

### Task 2: Implement Candidate Release and Protected Environment Migration

**Files:**
- Modify: `bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js`
- Test: `test-v29-drtarjomeh-security-release-deploy.js`
- Installed helper produced by bootstrap: `/opt/prhm-agent-selfmaint-exec/actions/drtarjomeh-security-release-deploy-v1.js`

**Interfaces:**
- Helper functions: `preflight()`, `materializeCandidate()`, `buildProtectedEnv()`, `verifyEnvAccess()`, `verifyCandidate()`, `atomicCutover()`, `rollback(state)`, `execute()`.
- Result path: `/var/lib/prhm-agent-selfmaint-exec/drtarjomeh-security-release-deploy-v1/latest.json`.
- Lock path: `/var/lib/prhm-agent-selfmaint-exec/drtarjomeh-security-release-deploy-v1/run.lock`.
- Backup root: `/var/backups/prhm-drtarjomeh-security-release-deploy-v1`.

- [ ] **Step 1: Write failing candidate/env fixture tests**

Create a temporary fake releases tree containing dummy DB/email/config credentials. Assert candidate creation leaves the source release byte-identical, produces a sibling release, overlays every `PAYLOAD` file, and never returns fixture secret values.

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test test-v29-drtarjomeh-security-release-deploy.js`
Expected: candidate/env tests FAIL until helper logic exists.

- [ ] **Step 3: Implement candidate materialization without shell interpolation**

Use fixed `execFile`/`spawnSync` arguments only (for example `cp -a --reflink=auto` where supported). Candidate name uses a fixed security prefix plus generated timestamp/nonce; it remains under `RELEASES_ROOT`. Never accept a destination path from caller input.

- [ ] **Step 4: Implement server-side protected env construction**

Derive current DB DSN/user/password and operational sender values only inside the privileged helper from validated current production config. Generate `DRT_APP_TOKEN`, `DRT_COOKIE_VALIDATION_KEY`, and `DRT_API_COOKIE_VALIDATION_KEY` using `crypto.randomBytes`. Force `DRT_YII_ENV=prod`, `DRT_YII_DEBUG=0`, `DRT_BASE_SCHEME=https`, `DRT_BASE_HOST=drtarjomeh.ir`, `DRT_MAIL_DRIVER=file`, `DRT_SMS_ENABLED=0`, and empty Slack values. Never include secret values in evidence or errors.

- [ ] **Step 5: Implement env ownership and runtime-readability gate**

Derive trusted UID/GID from validated production deployment metadata, not request input. Write env atomically as mode `0600`, reject symlinks/unknown existing preimages, then execute a fixed PHP readability probe under that UID/GID using Node child-process `uid`/`gid` options. Fail before cutover if runtime identity cannot be established or cannot read the file.

- [ ] **Step 6: Add Review Focus tests for env state and secret leakage**

Tests must cover: existing env symlink, mode broader than `0600`, unknown pre-existing env bytes, unreadable runtime UID/GID, and a thrown failure containing a fixture secret. Assert every case fails closed and sanitized result/error text excludes the fixture secret.

- [ ] **Step 7: Run tests**

Run: `node --test test-v29-drtarjomeh-security-release-deploy.js`
Expected: candidate/env tests PASS.

- [ ] **Step 8: Commit**

```bash
git add bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js test-v29-drtarjomeh-security-release-deploy.js
git commit -m "feat: build isolated DrTarjomeh security candidate"
```

### Task 3: Add Pre-Cutover Runtime Gates, Atomic Cutover, Smoke Tests, and Rollback

**Files:**
- Modify: `bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js`
- Test: `test-v29-drtarjomeh-security-release-deploy.js`

**Interfaces:**
- `verifyCandidate(candidateRoot, runtimeIdentity) -> sanitized evidence`.
- `atomicCutover(candidateRoot) -> previousRealpath`.
- `smokeProduction() -> fixed-route HTTP evidence` using only `SMOKE` from Task 1.
- `rollback(state) -> {performed, verified, error}`.

- [ ] **Step 1: Write failing verification/cutover tests**

Assert fixed PHP lint coverage for every PHP file in `PAYLOAD`, `scripts/test-environment-loader.php`, and six invocations of `scripts/probe-runtime-bootstrap.php` for `api`, `backend`, `frontend`, `panel`, `translator`, and `console`. Assert probes execute without email/SMS/Slack sends or database writes.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test test-v29-drtarjomeh-security-release-deploy.js`
Expected: verification/cutover tests FAIL.

- [ ] **Step 3: Implement candidate verification**

Run PHP lint on every PHP payload path. Run environment-loader contract and all six runtime probes from the candidate using the candidate protected env and trusted runtime identity. Require mail=file, SMS disabled adapter, debug/Gii off, and DB definitions environment-backed.

- [ ] **Step 4: Implement atomic pointer switch and the fixed public smoke**

Switch `public_html` with an atomic symlink rename only after all candidate gates pass. Probe exactly `drtarjomeh.ir/`; require status `200..399` and reject a response body containing `Internal Server Error`. No alternate host/path is accepted from request input.

- [ ] **Step 5: Implement complete rollback journal**

Track old release realpath, previous env existence/hash/backup, candidate path, and cutover state without secret content. On any failure after env/candidate mutation, restore previous env if changed; after cutover restore the old production symlink atomically; then rerun the same fixed public smoke. Distinguish `FAILED_ROLLED_BACK` from `FAILED_ROLLBACK_INCOMPLETE`.

- [ ] **Step 6: Add Review Focus post-cutover rollback test**

Inject a deterministic fixture smoke failure immediately after simulated cutover. Assert old release realpath is restored, previous env bytes/hash are restored, failed candidate remains for forensics, rollback smoke passes, and success is never reported.

- [ ] **Step 7: Add result-contract tests**

Successful sanitized result must include `target_commit`, `previous_release`, `new_release`, `preflight_passed`, `php_lint_passed`, `runtime_probe_passed`, `env_runtime_readability_passed`, `mail_fail_closed`, `sms_fail_closed`, `debug_disabled`, `cutover_performed`, `smoke_passed`, `database_mutation:false`, `provider_credential_rotation:false`, `credential_values_returned:false`, and `rollback_performed:false`.

- [ ] **Step 8: Run tests**

Run: `node --test test-v29-drtarjomeh-security-release-deploy.js`
Expected: all helper/cutover/rollback tests PASS.

- [ ] **Step 9: Commit**

```bash
git add bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js test-v29-drtarjomeh-security-release-deploy.js
git commit -m "feat: add rollback-safe DrTarjomeh security cutover"
```

### Task 4: Register the Fixed Level-4 Action Additively in Agent 3

**Files:**
- Modify: `bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js`
- Test: `test-v29-drtarjomeh-security-release-deploy.js`
- Installed control-plane surfaces: `/opt/prhm-agent-selfmaint/server.js`, `/opt/prhm-agent-selfmaint-exec/server.js`, `/opt/prhm-company-control-plane/config/approval-policy.json`, `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`.

**Interfaces:**
- `buildBaseCandidate(source)`, `buildExecCandidate(source, helperSha)`, `buildPolicyCandidate(source)`, `buildMcpCandidate(source)`.
- Bootstrap install transaction changes only the four control-plane surfaces plus the fixed helper.

- [ ] **Step 1: Write failing registration tests modeled on v27/v28**

Assert policy adds exactly one Level-4/critical operation with second confirmation, one-time use, 180-second expiry, Mohammad principal binding, and rollback reference. Assert action is not added to the Level-3 set. Assert MCP exposes only the fixed enum value and executor dispatch verifies exact helper SHA.

- [ ] **Step 2: Run registration tests and verify failure**

Run: `node --test test-v29-drtarjomeh-security-release-deploy.js`
Expected: registration tests FAIL.

- [ ] **Step 3: Re-read the live Agent 3 four-file SHA baseline immediately before finalizing patches**

Use approved read-only control-plane SHA inspection. Compare against development snapshot. If any SHA changed—especially because of the separate Titan work—stop, rebase transformation anchors onto the new live sources, update only the v29 pinned baseline constants/tests, and rerun all tests. Never install historical control-plane candidates over newer live files.

- [ ] **Step 4: Implement additive transformations**

Add only `drtarjomeh_security_release_deploy_v1` to the base registry, executor spec/dispatch, policy operation/typed scope, and MCP enum. Preserve every existing action and confirmation behavior byte-for-byte outside unique additive anchors.

- [ ] **Step 5: Implement fixed systemd sandbox**

Executor launches only the fixed helper with no arguments. Grant only paths required for DrTarjomeh releases, `/etc/drtarjomeh`, action backup/result/lock paths, and required runtime sockets/temp state. Use `ProtectSystem=strict`, `ProtectHome=read-only`, `NoNewPrivileges=true`, restricted capabilities, and only the address families required by the fixed HTTP smoke. No raw shell or arbitrary write surface.

- [ ] **Step 6: Add baseline-drift and action-preservation tests**

Test that any pinned SHA mismatch stops before write. Feed fixture control-plane sources containing Titan and all current action names and assert candidate transformations preserve them while adding exactly one DrTarjomeh action.

- [ ] **Step 7: Implement bootstrap transaction and rollback**

Sequence: current baseline SHA guard → helper SHA generation → backups → additive candidates → JS syntax and policy JSON validation → atomic installation → required service refresh → schema/readiness verification → persisted sanitized install result. On failure restore every changed file and verify services/schema after rollback.

- [ ] **Step 8: Run tests and syntax checks**

Run:

```bash
node --check bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js
node bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js --selftest-only
node --test test-v29-drtarjomeh-security-release-deploy.js
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js test-v29-drtarjomeh-security-release-deploy.js
git commit -m "feat: register DrTarjomeh security deploy host action"
```

### Task 5: Add CI and Perform Whole-Branch Review

**Files:**
- Create: `.github/workflows/host-actions-v29-drtarjomeh-security-release-ci.yml`
- Modify if review requires: v29 bootstrap/test only.

**Interfaces:**
- CI validates syntax, selftest, and Node contract tests without touching production.

- [ ] **Step 1: Write the path-scoped CI workflow**

Trigger on PR changes to the v29 bootstrap/test/workflow and on branch `feature/drtarjomeh-security-release-deploy-v1`. Steps: checkout, `node --check`, `node bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js --selftest-only`, then `node --test test-v29-drtarjomeh-security-release-deploy.js`.

- [ ] **Step 2: Validate workflow and run local test commands**

Run the exact three CI commands from Task 4. Expected: PASS.

- [ ] **Step 3: Open/update a PR for the Host Actions branch**

PR body must state: registration only until Level-4 installation; no DrTarjomeh production mutation occurs by merge; provider credential rotation remains out of scope.

- [ ] **Step 4: Review exact diff**

Review specifically for arbitrary command/path/revision input, embedded real secrets, missing rollback, overly broad sandbox paths, action loss, historic Agent 3 overwrite risk, and payload files outside the exact 24-path set.

- [ ] **Step 5: Verify GitHub CI is GREEN on the exact reviewed HEAD**

Do not proceed from an earlier green commit.

- [ ] **Step 6: Commit any review corrections and rerun all gates**

If corrections are needed, use focused commits and repeat Step 5.

### Task 6: Install the New Action Through the Existing Fixed Control-Plane Channel

**Files:**
- No DrTarjomeh production application mutation in this task.
- Control-plane registration only.

**Interfaces:**
- Consumes exact reviewed Host Actions commit and current live four-file Agent 3 baseline.
- Produces a fresh connector schema containing `drtarjomeh_security_release_deploy_v1` while preserving all existing actions.

- [ ] **Step 1: Re-read live four-file SHA values again immediately before installation**

If any SHA differs from the bootstrap pins, stop. Refresh pins/anchors on the branch, rerun CI/review, and install only the newly reviewed exact HEAD.

- [ ] **Step 2: Install through the established SHA-bound GitHub/root-of-trust Host Actions deployment path**

Do not use raw SSH edits, `ops_execute` write bypass, or the unavailable DeployHQ API path. Installation must use the existing fixed control-plane bootstrap channel and its own rollback/evidence contract.

- [ ] **Step 3: Verify installation result and service health**

Require installed SHA parity, syntax/policy PASS, required services active, rollback not invoked, and no application/database mutation.

- [ ] **Step 4: Verify fresh MCP schema in a new connector view**

Require the new action to appear in `host_action_v2_request.action`, and confirm the existing Titan and all other current fixed actions remain exposed. This is the explicit regression gate for parallel-chat interference.

### Task 7: Create the Level-4 Request and Apply the DrTarjomeh Security Release

**Files:**
- No repository changes expected.

**Interfaces:**
- Consumes the live fixed action and explicit Level-4 approval request.
- Produces a new production sibling release and sanitized action result, or verified automatic rollback.

- [ ] **Step 1: Run fresh read-only production preflight**

Verify `public_html` still resolves to `20260805-011747-672d32f490bd`, fixed root smoke is healthy, expected preimages still match, and protected env state matches the action's bound expectation. Any drift stops execution.

- [ ] **Step 2: Create a fresh fixed Host Actions v2 Level-4 request**

Request only `drtarjomeh_security_release_deploy_v1`. Verify pending metadata binds the exact action, critical risk, Level 4, one-time semantics, and current policy version.

- [ ] **Step 3: Apply using literal `CONFIRM_LEVEL_4_CRITICAL`**

Use only the request UUID returned in Step 2. No replacement code, command, path, or credentials are supplied at apply time.

- [ ] **Step 4: Validate returned result contract**

Require `ok:true`, target commit equality, all preflight/lint/runtime/env/smoke gates true, `database_mutation:false`, `provider_credential_rotation:false`, `credential_values_returned:false`, and `rollback_performed:false`. If the action failed, inspect only sanitized rollback evidence and do not retry blindly.

- [ ] **Step 5: Perform independent post-deploy verification**

Read-only verify: `public_html` now resolves to the new sibling release; old release still exists; `/etc/drtarjomeh/production.env` is regular, mode `0600`, and runtime-readable without revealing content; the fixed `drtarjomeh.ir/` public smoke passes; mail/SMS/Slack remain fail-closed.

- [ ] **Step 6: Record closure evidence for the deploy portion of Issues #9/#13**

Document exact non-secret release ID, target commit, action request/result status, and gates. Do not close the credential-exposure issue as fully remediated yet because old provider credentials have not all been rotated/revoked.

### Task 8: Hand Off to Separate Provider Credential Rotation Closure

**Files:**
- Separate follow-up design/plan or provider-specific fixed operations; not part of this action implementation.

**Interfaces:**
- Consumes healthy security release from Task 7.
- Produces final revocation/rotation evidence for primary/secondary DB credentials, Gmail/SMTP credential, Mediana SMS key, and Slack token if still used.

- [ ] **Step 1: Confirm the security release remains healthy with external delivery disabled**

- [ ] **Step 2: Create provider-specific rotation work rather than extending this action**

Each rotation must have its own validation and old-credential revocation evidence. Do not silently bundle provider admin changes into `drtarjomeh_security_release_deploy_v1`.

- [ ] **Step 3: Close Issue #9/#13 only after old credentials are proven unusable and required services are rebound to rotated values**
