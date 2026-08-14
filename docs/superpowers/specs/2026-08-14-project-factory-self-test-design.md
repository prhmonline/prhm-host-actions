# Project Factory Self-Test Design

Date: 2026-08-14
Status: Approved design
Target standard: `PRHM_NEW_SITE_V1`
Target action: `project_factory_selftest_v1`

## 1. Goal

Add a reusable, fixed, approval-bound Project Factory self-test that proves the standard new-site bootstrap works end-to-end without touching production projects, production domains, real databases, or deploy targets.

The self-test exists to replace repeated one-off validation scripts with one canonical control-plane action that returns a compact PASS/FAIL result with auditable evidence.

## 2. Approval model

The chosen model is:

- Installing, changing, or removing the self-test action, helper, policy, executor registration, or plugin schema is a Level-4 critical control-plane mutation.
- Normal execution of the already-installed self-test is Level-2.
- The runtime action is fixed and accepts no arbitrary command, path, shell, SQL, domain, repository, package, project, or environment input.
- A Level-2 execution cannot alter the implementation, policy, expected Factory SHA, allowlist, dependency baseline, or test manifest.

## 3. Architecture

Use a fixed Host Action named:

`project_factory_selftest_v1`

The Host Action dispatches to a dedicated SHA-bound helper rather than embedding self-test logic into `/opt/prhm-project-factory/factory.js`.

Recommended helper path:

`/opt/prhm-agent-selfmaint-exec/actions/project-factory-selftest-v1.js`

Recommended state directory:

`/var/lib/prhm-agent-selfmaint-exec/project-factory-selftest-v1`

Recommended latest-result file:

`/var/lib/prhm-agent-selfmaint-exec/project-factory-selftest-v1/latest.json`

The helper owns orchestration, evidence collection, concurrency locking, positive E2E validation, negative rollback validation, and cleanup. The Project Factory remains responsible only for project materialization.

## 4. Isolation and write boundary

The action may create disposable project roots only beneath:

`/home/prhm/projects/generated`

Each execution creates a unique slug with a fixed prefix, for example:

`factory-selftest-<timestamp>-<random>`

Before materialization, the helper must fail closed unless all of the following are true:

- `/home/prhm/projects/generated` resolves beneath the expected owner root.
- The generated root is a real directory and is not a symlink.
- The disposable target does not already exist.
- The basename matches the fixed self-test slug grammar.
- No other Project Factory self-test lock is active.
- The installed Factory SHA matches the SHA explicitly allowlisted by the installed self-test version.
- The installed Factory version is the supported version, initially `1.3.4`.

The action must never accept a caller-supplied target path or slug.

## 5. Fixed test manifest

The helper supplies a fixed manifest to the Factory. It must include:

- `standard_id: PRHM_NEW_SITE_V1`
- a generated disposable slug
- a clearly disposable project name
- fixed test-only domains under the reserved `.invalid` top-level domain, which are never provisioned
- fixed language/module values sufficient to exercise normal Factory validation
- `features.e2e_test: true`

No DNS, TLS, database provisioning, deploy, payment gateway, SMS provider, or production configuration is performed.

## 6. Positive E2E test

The positive test invokes the installed Project Factory exactly as a real new-site bootstrap would.

The required successful sequence is:

1. Laravel API scaffold.
2. Laravel Sanctum and Spatie Permission installation.
3. Next.js Web scaffold.
4. Web security step.
5. Next.js Admin scaffold.
6. Admin security step.
7. Git initialization.
8. Ownership normalization.
9. Final bootstrap state `ready_for_configuration`.

For the initially supported Factory `1.3.4`, Web and Admin must resolve exactly this approved security baseline:

- Next.js `16.2.12`
- PostCSS `8.5.23`
- sharp `0.35.3`

A future dependency-version change is not accepted implicitly. It requires a new Level-4 update of the self-test implementation and its SHA-bound expected baseline.

The helper independently verifies that these required artifacts exist:

- `apps/api/artisan`
- `apps/api/composer.json`
- `apps/api/composer.lock`
- `apps/web/package.json`
- `apps/web/package-lock.json`
- `apps/admin/package.json`
- `apps/admin/package-lock.json`
- `.git/HEAD`
- `.prhm/bootstrap-state.json`

The helper must parse the bootstrap state and require:

- `ok === true`
- `status === ready_for_configuration`
- expected Factory version
- all expected steps present
- each expected step has `exit_code === 0`
- each expected step has `error === null`

## 7. Security gates

For both Web and Admin, the self-test independently verifies the installed dependency state rather than trusting scaffold stdout alone.

Required checks:

- `npm audit --json` succeeds.
- `critical === 0`.
- `high === 0`.
- `npm ls` for Next.js, PostCSS, and sharp succeeds.
- resolved package versions exactly match the SHA-bound approved baseline for the installed self-test version.
- `next build` succeeds for both applications.

Any High/Critical vulnerability, dependency-tree failure, version mismatch, or production build failure makes the self-test fail.

## 8. Negative rollback test

Each self-test execution also proves that Project Factory false-success protection still works.

The negative test must use a temporary candidate/test copy of the Factory implementation, never mutate the installed Factory bytes.

The candidate modifies only the behavior necessary to simulate a subprocess that returns success without producing a required artifact, initially targeting the `next_web` postcondition.

The negative test passes only when all of the following are proven:

- subprocess exit status can be zero while the required artifact is absent;
- Factory detects the missing postcondition;
- terminal result is a materialization failure;
- `failed_step === next_web` or the exact designated negative-test step;
- rollback reports success;
- the failed disposable root is absent afterward;
- the installed production Factory SHA is unchanged.

If the negative test does not trigger the expected failure, the overall self-test fails.

## 9. Locking and concurrency

Use an atomic lock beneath the self-test state directory.

If a lock already exists, execution must fail closed with an explicit `already_running` result. The action must not run two full Factory materializations concurrently.

The lock is removed in a `finally` path. A stale-lock recovery policy may be added only through a later Level-4 design/update; v1 must not guess that a lock is stale.

## 10. Cleanup semantics

Cleanup is mandatory and is part of the test result, not best-effort housekeeping.

The helper must use a `finally` path to remove:

- positive-test disposable root;
- negative-test disposable root;
- temporary candidate Factory copy;
- temporary files used only for the test;
- execution lock.

Deletion is allowed only after exact parent, basename/prefix, standard ID, and `features.e2e_test === true` guards pass where applicable.

If a disposable root or temporary candidate remains after cleanup, the overall result is FAIL even if all functional checks passed.

The helper must never recursively delete a caller-supplied path.

## 11. Result schema and evidence

The helper writes a single latest result atomically to `latest.json` and emits the same result on stdout.

Minimum result fields:

```json
{
  "schema_version": "prhm.host-action-result.v1",
  "ok": true,
  "action": "project_factory_selftest_v1",
  "finished_at": "ISO-8601",
  "factory_version": "1.3.4",
  "factory_sha256": "...",
  "positive_e2e": true,
  "web_audit_high": 0,
  "web_audit_critical": 0,
  "admin_audit_high": 0,
  "admin_audit_critical": 0,
  "web_build": true,
  "admin_build": true,
  "negative_rollback": true,
  "cleanup": true,
  "production_mutated": false
}
```

Additional evidence may include:

- bootstrap-state SHA256;
- package-lock SHA256 values;
- resolved Next/PostCSS/sharp versions;
- step names and exit codes;
- test root basenames;
- negative-test terminal evidence;
- cleanup evidence.

Secrets, bearer tokens, credentials, environment secrets, or production config values must not be persisted.

## 12. Host Action registration

The installation bootstrap should follow existing PRHM Host Action conventions:

- exact SHA checks of all files to be patched;
- fixed action enum/allowlist registration;
- fixed operation name, recommended `host_action.project_factory_selftest_v1`;
- policy level `2` for execution;
- explicit principal/role scope;
- no arbitrary action arguments;
- helper SHA recorded in installation evidence;
- syntax checks before installation;
- preinstall and postinstall self-tests;
- atomic writes;
- backups before mutation;
- automatic rollback on installation failure;
- service health verification after installation.

The installation itself is still gated by a fresh Level-4 approval because it mutates control-plane policy and Host Action code.

## 13. Failure behavior

The action is fail closed.

Examples of terminal failure conditions include:

- Factory SHA/version drift;
- generated-root confinement failure;
- active lock;
- positive E2E step failure;
- missing artifact;
- npm audit High/Critical finding;
- dependency version mismatch;
- Web/Admin build failure;
- negative rollback test not failing as expected;
- installed Factory SHA changing during the test;
- cleanup failure;
- result persistence failure.

A partial success is never reported as PASS.

## 14. Non-goals

Version 1 explicitly does not:

- deploy a generated project;
- create DNS records;
- provision TLS;
- create a production or staging database;
- contact payment/SMS providers;
- modify existing generated projects;
- mutate `/opt/prhm-project-factory/factory.js` during normal execution;
- test Honartik or other non-`PRHM_NEW_SITE_V1` stacks;
- accept arbitrary test manifests or paths;
- auto-upgrade package versions.

## 15. Acceptance criteria

Implementation is accepted only when all of these are demonstrated with fresh evidence:

1. Installation requires a fresh Level-4 approval and rolls back cleanly on a forced installation failure.
2. The installed action appears in the Host Action request schema as `project_factory_selftest_v1`.
3. A fresh request identifies the action as Level-2 and contains no caller-controlled arguments.
4. A normal apply executes exactly one positive E2E and one negative rollback test.
5. Positive E2E returns zero High/Critical audit findings for Web and Admin, exact approved dependency versions, and both builds succeed.
6. Negative rollback test proves missing-artifact false-success detection and root rollback.
7. Installed Factory SHA is identical before and after execution.
8. No production project, production service configuration, domain, TLS, database, or secret is mutated.
9. All disposable roots and temporary files are absent after execution.
10. `latest.json` is valid, atomic, and contains sufficient evidence to diagnose PASS/FAIL.
11. A second concurrent invocation fails closed instead of running concurrently.

## 16. Implementation boundary

This document approves the architecture only. It does not authorize installation or any control-plane mutation.

The next phase is to write a detailed implementation plan. Actual installation must use a new Level-4 request and confirmation specific to the final SHA-bound installation candidate.
