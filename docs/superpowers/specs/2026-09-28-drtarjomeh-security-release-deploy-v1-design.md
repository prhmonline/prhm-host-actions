# DrTarjomeh Security Release Deploy v1 — Design Spec

## Status

Design approved in chat on 2026-09-28. This document is the implementation contract. No production mutation is authorized by this document alone.

## Goal

Introduce a fixed, typed, Level-4 Host Action named `drtarjomeh_security_release_deploy_v1` that deploys only the credential-remediation/security changes from the already-reviewed DrTarjomeh remediation commit, using a new sibling release with atomic cutover and automatic rollback.

The action must not perform a general `main` deployment and must not accept arbitrary command, path, revision, environment-file content, credential value, or service input.

## Fixed identities

- Application repository: `prhmonline/drtarjomeh`
- Approved remediation commit: `f22b1d17801239f7539f84e5aa8b91250c87dc58`
- Current production release identity required by preflight: `20260805-011747-672d32f490bd`
- Production root: `/home/drtarjomeh/domains/drtarjomeh.ir/public_html`
- Releases root: `/home/drtarjomeh/domains/drtarjomeh.ir/releases`
- Protected environment file: `/etc/drtarjomeh/production.env`
- Host Action: `drtarjomeh_security_release_deploy_v1`
- Approval operation: `host_action.drtarjomeh_security_release_deploy_v1`
- Risk: `critical`
- Approval level: `4`
- Second confirmation: required
- One-time request: required

Any mismatch in fixed identity or bound preimage must fail closed before production cutover.

## Scope

### In scope

The action may deploy only the runtime/security subset introduced by the approved remediation change. The intended security behaviors are:

1. protected `DRT_*` environment loading from `/etc/drtarjomeh/production.env`;
2. removal of runtime reliance on tracked DB, SMTP, SMS, Slack, app-token, and cookie-key literals;
3. `YII_ENV=prod`, debug disabled by default, and no Gii/debug bootstrap in production;
4. mail fail-closed to file transport until SMTP is explicitly re-enabled with rotated credentials;
5. SMS fail-closed through `DisabledSmsService` until Mediana is explicitly re-enabled with rotated credentials;
6. Slack logging disabled unless a valid rotated environment-backed token/channel set exists;
7. environment-backed DB connection definitions;
8. environment-backed application and cookie keys;
9. CLI/cron bootstrap support using the same protected environment loader;
10. runtime bootstrap verification across `api`, `backend`, `frontend`, `panel`, `translator`, and `console`.

### Out of scope

The action must not:

- deploy unrelated feature work from `main`;
- rotate Gmail, Mediana, Slack, database, or any third-party credential at the provider control plane;
- change application database schema or data;
- change DNS, firewall, TLS, Apache virtual-host definitions, PHP-FPM configuration, or system package state;
- delete historical releases;
- expose credential values in result JSON, stdout, stderr, journal, or MCP responses;
- accept caller-supplied shell, SQL, revision, path, URL, environment content, or credentials.

Provider-side credential rotation is a separate follow-up operation after this deploy is healthy.

## Release strategy

The deployment is a security hot-release, not an in-place patch and not a full application upgrade.

1. Verify `public_html` resolves to the expected current release.
2. Create a new sibling release under the releases root.
3. Materialize the current production release into the new sibling while preserving required ownership, modes, and release-local runtime structure.
4. Overlay only the fixed security-remediation files whose contents are embedded or otherwise SHA-bound to the action implementation.
5. Create or update `/etc/drtarjomeh/production.env` using server-side derivation/generation rules without printing values.
6. Run syntax and runtime verification against the new release before cutover.
7. Atomically switch the production symlink to the new release.
8. Run post-cutover smoke verification.
9. On any post-mutation failure, atomically restore the previous production symlink and verify rollback health.

The previous release remains intact and is the rollback target.

## Protected environment contract

`/etc/drtarjomeh/production.env` must be a regular non-symlink file with mode `0600`.

Its owner UID/GID must be derived from fixed, trusted production deployment metadata rather than caller input. The implementation must verify that the effective DrTarjomeh application runtime identity can read the file and that no group/world access exists. If the runtime identity cannot be established or cannot read the protected file, preflight/candidate verification fails closed before cutover.

Required production values include:

- `DRT_YII_ENV=prod`
- `DRT_YII_DEBUG=0`
- `DRT_BASE_SCHEME=https`
- `DRT_BASE_HOST=drtarjomeh.ir`
- `DRT_APP_TOKEN`
- `DRT_COOKIE_VALIDATION_KEY`
- `DRT_API_COOKIE_VALIDATION_KEY`
- primary DB DSN/user/password
- secondary DB DSN/user/password
- operational/sender email values required by the application

Until provider rotation is completed:

- `DRT_MAIL_DRIVER=file`
- `DRT_SMS_ENABLED=0`
- Slack token/channel values are absent or empty

### Secret migration rules

- Existing production DB connection values may be derived server-side from the current production configuration only inside the privileged action.
- Derived secrets must never be returned or logged.
- New application token and cookie validation keys are generated server-side using a cryptographically secure source.
- The environment write must be atomic.
- A pre-existing protected env file may only be replaced when its expected preimage is explicitly bound by the action; otherwise fail closed.

## Fixed file set

Implementation must derive the exact runtime/security file list from the approved remediation commit and freeze it in the action/test fixture. The set is expected to include the secure environment loader and the production runtime/config files necessary for:

- API cookie configuration;
- shared base configuration;
- production environment configuration;
- application params;
- disabled SMS adapter;
- Mediana adapter hardening;
- web bootstraps for API/backend/frontend/panel/translator;
- console bootstrap/config;
- legacy site-specific override neutralization;
- runtime probe used by verification.

CI-only files such as GitHub workflow definitions and tracked-secret scanner tooling are not production release payloads unless implementation tests prove they are needed at runtime.

Each production payload file must have a fixed expected destination SHA after overlay.

## Preflight

Before any production mutation, the action must verify:

1. current `public_html` realpath equals the fixed expected release;
2. releases root and current release are regular expected filesystem objects with no unsafe symlink traversal;
3. the source/current release preimages used by overlay are the expected SHAs;
4. enough free space exists for one sibling release plus temporary files;
5. `/etc/drtarjomeh` can be created or validated safely;
6. target release path does not already exist;
7. no concurrent DrTarjomeh security deploy lock is active;
8. PHP runtime required for lint/probe is available;
9. application runtime identity and protected-env readability can be verified without broadening permissions;
10. no database mutation is planned;
11. the action helper itself matches the SHA registered by the executor.

Preflight returns only non-secret evidence.

## Verification gates before cutover

The new release must pass all of the following before symlink switch:

- PHP syntax validation for every modified PHP file;
- secure environment loader contract checks;
- protected env mode/owner/readability verification under the application runtime identity;
- runtime bootstrap probe for `api`;
- runtime bootstrap probe for `backend`;
- runtime bootstrap probe for `frontend`;
- runtime bootstrap probe for `panel`;
- runtime bootstrap probe for `translator`;
- runtime bootstrap probe for `console`;
- confirmation that mail is fail-closed to file transport;
- confirmation that SMS resolves to the disabled adapter;
- confirmation that production debug/Gii are disabled;
- confirmation that both DB component definitions are environment-backed.

Runtime probes must not send email/SMS/Slack messages and must not perform application data writes.

## Atomic cutover

The production pointer change must be atomic. The action records:

- previous production realpath;
- new release realpath;
- cutover timestamp;
- non-secret release identifier;
- target remediation commit identity.

No old release is deleted during this action.

## Post-cutover smoke tests

The action performs bounded local/production smoke tests for the primary public site and relevant application surfaces. A successful smoke gate requires acceptable HTTP responses and no bootstrap/config fatal error.

The exact route list must be fixed in the implementation and must not accept caller input.

External third-party delivery tests are not part of this action because mail/SMS/Slack remain intentionally disabled until credential rotation.

## Rollback

If any failure occurs after the new release or environment file has been mutated:

1. restore the previous production symlink atomically if cutover occurred;
2. restore the previous protected env file when one existed and was replaced;
3. preserve the failed sibling release for forensic inspection unless cleanup is provably safe;
4. run rollback smoke verification against the previous production release;
5. persist non-secret rollback evidence.

If rollback itself cannot be verified, the action must return an explicit `rollback_failed` condition and stop. It must never report success after an unverified rollback.

## Host Action registration

The action is registered through existing Host Actions v2 architecture. Required properties:

- fixed enum entry in MCP; no free-form input;
- fixed operation in approval policy;
- Level 4 / critical;
- second confirmation required;
- one-time request with expiry;
- executor maps exactly one action name to exactly one helper;
- helper SHA is checked before execution;
- systemd sandbox grants only the minimum paths/capabilities needed for DrTarjomeh release/env mutation and local smoke verification;
- action-local rollback contract is declared in the base control-plane registry.

The implementation must not broaden generic `ops_execute`, generic filesystem write, or raw-shell permissions.

## Result contract

Success result must use `prhm.host-action-result.v1` and include non-secret evidence such as:

- `ok: true`
- `action: drtarjomeh_security_release_deploy_v1`
- `target_commit`
- `previous_release`
- `new_release`
- `preflight_passed: true`
- `php_lint_passed: true`
- `runtime_probe_passed: true`
- `env_runtime_readability_passed: true`
- `mail_fail_closed: true`
- `sms_fail_closed: true`
- `debug_disabled: true`
- `cutover_performed: true`
- `smoke_passed: true`
- `database_mutation: false`
- `provider_credential_rotation: false`
- `credential_values_returned: false`
- `rollback_performed: false`

Failure/rollback results must use the same action identity and expose only bounded non-secret error/evidence fields.

## Security invariants

- No arbitrary shell or path input.
- No user-supplied revision.
- No user-supplied secret.
- No secret in logs/results.
- No DB write.
- No provider-side rotation.
- No unrelated application deployment.
- No in-place modification of the live release.
- Cutover only after full pre-cutover gate passes.
- Automatic rollback on post-mutation failure.
- Existing Agent 3 operations retain their current behavior and authorization level.

## Acceptance criteria

Implementation is acceptable only when all of the following are true:

1. repository tests prove the action is fixed-input and SHA-bound;
2. installer/registration tests prove only the intended four control-plane surfaces plus action helper are changed;
3. policy classifies the action as Level 4 critical;
4. preflight fails against any unexpected current release/preimage;
5. production payload is limited to the remediation runtime/security subset;
6. protected env is mode `0600`, readable by the verified application runtime identity, not group/world accessible, and no credential value appears in evidence;
7. all six runtime probes pass before cutover;
8. smoke verification passes after cutover;
9. rollback test demonstrates restoration of the old release pointer on simulated post-cutover failure;
10. no database write or external notification send occurs;
11. final live verification confirms production points to the new release and the old release remains available for rollback.

## Follow-up after this action

After the deployment is healthy, rotate/revoke exposed provider credentials in separate, provider-specific operations:

- primary/secondary DB credentials as applicable;
- Gmail/SMTP credential;
- Mediana SMS key;
- Slack token if still used.

Those operations require their own verification and must not be silently bundled into this deploy action.
