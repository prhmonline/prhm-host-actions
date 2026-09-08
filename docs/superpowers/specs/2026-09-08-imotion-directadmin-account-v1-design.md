# iMotion DirectAdmin Account v1 Design

## Status
Execution design approved by user checkpoint on 2026-09-08. Production mutation remains gated by a fresh Level-4 approval after actual preflight evidence is collected.

## Goal
Create exactly one DirectAdmin user named `imotion` with primary domain `imotion.ir` on target `10.71.0.10`, while leaving current iMotion production runtime untouched until later migration verification/cutover.

## Fixed Scope
- Target host: `10.71.0.10` only.
- Never contact `10.71.0.117`.
- DirectAdmin user: `imotion` only.
- Primary domain: `imotion.ir` only in this action.
- Future iMotion domains remain out of mutation scope for this action.
- No database, DNS cutover, SSL cutover, application deploy, production runtime change, or old-server change.
- No DirectAdmin admin password is requested, accepted, returned, logged, or persisted.

## Preflight Contract
The existing zero-input `imotion_directadmin_preflight_v1` is the canonical first step. Its evidence must prove:
- target host is exactly `10.71.0.10`;
- SSH host-key fingerprint is present and stable;
- DirectAdmin binary exists and version is readable;
- DirectAdmin service is active;
- TCP/2222 is listening;
- DirectAdmin admin identity is readable with `da admin`;
- `da api-url` is available;
- `da login-url` is available;
- `da taskq` is available;
- a supported database client exists;
- user `imotion` does not exist;
- none of the fixed iMotion domains is already owned by another DirectAdmin user.

The resulting evidence is treated as a binding input to code generation. The production action is not generated until this actual preflight succeeds.

## DirectAdmin API Strategy
Use only the DirectAdmin root CLI and official local API flow:
1. Generate a short-lived admin API URL immediately before each API sequence with `da api-url`.
2. Never print, persist, cache, return, or include the generated URL in error text.
3. Use the legacy API endpoint `CMD_API_ACCOUNT_USER` to create one custom user with username `imotion` and primary domain `imotion.ir`.
4. Re-read user state with `CMD_API_SHOW_ALL_USERS` and `CMD_API_SHOW_USER_CONFIG`.
5. Use `CMD_API_SELECT_USERS` only for rollback deletion of `imotion` when rollback eligibility is proven.

The action must not use a caller-provided host, path, username, password, domain, IP, package, command, JSON payload, or endpoint.

## Credential Handling
The `imotion` account password is generated in memory with cryptographically secure randomness during apply. It is not logged or returned. The action does not persist the password. Subsequent administrative access can use the root-side official `da login-url --user=imotion` mechanism and a separately authorized password-reset flow if needed.

## Binding Model
The generated production action must embed:
- expected target: `10.71.0.10`;
- expected SSH host-key fingerprint from actual preflight;
- expected DirectAdmin admin username from actual preflight;
- expected DirectAdmin version/identity fingerprint sufficient to detect material target drift;
- expected state: `imotion` absent;
- expected primary domain ownership: `imotion.ir` unowned;
- expected ownership state for all fixed iMotion domains from the canonical preflight;
- exact action source SHA-256 after generation.

Immediately before mutation, the action re-runs the same fixed preconditions and fails closed on any mismatch.

## User Creation Contract
Create exactly one user `imotion` with primary domain `imotion.ir`. Use custom-user creation rather than relying on an unknown reseller package. The exact feature flags and server IP are selected only from validated server-side evidence and are not caller-overridable. `notify=no` is required so generated credentials are not emailed.

## Rollback Eligibility
Rollback is action-local and may delete only the `imotion` account created by the current invocation. Rollback is eligible only when all of the following hold:
- this invocation has a persisted journal proving it created `imotion`;
- the user did not exist in the bound preimage;
- readback shows `imotion` still has primary domain `imotion.ir`;
- ownership/readback has not drifted to an unexpected state;
- the rollback request is internal to the same failed apply transaction.

Rollback must never delete a pre-existing user, a user created by another invocation, or any unrelated DirectAdmin artifact.

## Apply Sequence
1. Verify zero unexpected runtime inputs.
2. Re-run target fingerprint and DirectAdmin preconditions.
3. Verify `imotion` and `imotion.ir` remain absent/unowned.
4. Generate a strong `imotion` password in memory.
5. Generate a fresh `da api-url` credential in memory.
6. Resolve the exact allowed DirectAdmin shared/free IP from live read-only API evidence.
7. POST the fixed custom-user payload for `imotion` + `imotion.ir`.
8. Persist a secret-free mutation journal identifying only the created username/domain and precondition fingerprints.
9. Verify user exists exactly once and `CMD_API_SHOW_USER_CONFIG` reports username `imotion`, domain `imotion.ir`, expected creator/admin and expected IP.
10. Verify no other fixed iMotion domain changed ownership.
11. Return success only after verification.

Any failure after user creation triggers guarded rollback and post-rollback verification.

## Approval Boundary
Development, tests, Git commits, pushes, and read-only preflight do not authorize DirectAdmin mutation. The first actual DirectAdmin mutation may occur only after one fresh Level-4 approval bound to the exact generated action SHA and current preflight evidence.

## Git Rule
Every source/test/bootstrap change must be committed and pushed in the same cycle. Production is not DONE until runtime action SHA equals the pushed Git artifact SHA and remote branch/commit parity is verified.

## TDD Requirements
RED tests must prove failure for:
- wrong target;
- host-key mismatch;
- DirectAdmin version/admin drift;
- inactive service or closed 2222;
- missing `da api-url` capability;
- pre-existing `imotion`;
- pre-owned `imotion.ir`;
- any ownership drift among fixed iMotion domains;
- any runtime arguments;
- API credential leakage attempts;
- create response error;
- incorrect post-create readback;
- rollback when journal does not prove this invocation created the user;
- rollback when post-create state has drifted.

GREEN tests must prove:
- no mutation before all preconditions pass;
- exactly one create call with fixed username/domain;
- generated password never appears in result/log/journal fixtures;
- fresh API URL is not persisted;
- exact post-create verification;
- verified rollback deletes only `imotion` created by the current invocation;
- rollback failure is surfaced as critical/incomplete;
- no unrelated domain/application/database mutation capability exists.

## Success Criteria
The action is complete only when actual preflight is PASS, the production artifact is generated from that evidence, TDD is green, Git push/remote parity is green, the fixed action is installed with runtime SHA parity, a fresh Level-4 approval is consumed once, `imotion` + `imotion.ir` are verified on `10.71.0.10`, and current iMotion production remains untouched.