# Safe Delivery Profile Enable Next v1 — Design

## Goal
Add one fixed, fail-closed Host Action that enables only the next permitted Safe Delivery profile in the canonical rollout sequence without accepting arbitrary project, path, command, URL, service, credential, or payload input.

## Canonical rollout
`drtarjomeh_prod -> rahkomak_prod -> cfpark_front_prod -> titan_front_prod -> imotion_front_prod`

The action MUST derive the next project from the persisted Safe Delivery state. It MUST NOT accept a project name from the caller.

## Action contract
- Action: `safe_delivery_profile_enable_next_v1`
- Operation: `host_action.safe_delivery_profile_enable_next_v1`
- Risk: Level-4 / critical
- One-time approval request with explicit second confirmation
- Requested approver: `mohammad`
- Fixed control-plane scope only

## Preconditions
1. State parses and matches the expected schema.
2. Enabled profiles form a contiguous prefix of the canonical rollout.
3. There is exactly one next profile.
4. The next profile exists in the project registry and has a defined delivery profile.
5. The target service/health contract passes a fixed preflight.
6. No unrelated state drift is present.

## Mutation
Call the existing Safe Delivery profile-enablement primitive for the derived next project. Persist atomically. Do not edit application source, database, DNS, TLS, credentials, Git refs, or arbitrary files.

## Verification
After mutation:
- state parses;
- exactly one profile changed from disabled to enabled;
- the changed profile is the derived next project;
- enabled profiles remain a contiguous prefix;
- target service and health check pass.

## Rollback
Capture the exact preimage bytes and SHA-256 before mutation. If post-verification fails, restore the exact preimage atomically and verify SHA parity. A failed rollback must surface as a hard failure.

## Input boundary
The executor/helper accepts zero user-controlled mutation fields. No arbitrary shell execution, path, command, project, URL, service, credential, or payload input is permitted.

## Initial production target
With the currently verified state, the first target is `cfpark_front_prod`. Titan and iMotion may only follow through separate fresh Level-4 requests after each previous activation verifies successfully.
