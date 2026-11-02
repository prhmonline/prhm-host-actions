# Solo Company — Agent Operationalization, Stage 1
**Status:** Stage 1 authenticated, live Agent2 read-only WorkOrder UAT **PASS**. All persistent autonomous workflows remain **DISABLED** in the production Solo Runtime.

## Observed actual architecture (2026-11-03)

- Runtime release `0eb43d72aab3f10db22172c8be4c0411cf22d074`, active/enabled, `127.0.0.1:8782/health` OK.
- Installed implementation contains an `EngineeringAgent` state-machine orchestrator, **not** a generative-AI planner or a multi-agent team.
- `createProductionService()` currently passes `descriptors: []`, `allowedMutationCapabilities: []` at both transport/client, and `schedules: []`.
- Live MCP bridge discovery: 180 exposed tools; 77 with `annotations.readOnlyHint=true` at test time. Do not assume unannotated tools are safe: for instance `health_check` was **not** labeled read-only, whereas `selfmaint_health` was.
- Live Agent 3 API was healthy, but Solo had zero real tasks processed and zero active schedule in its production worker.

## Executed first real WorkOrder (repeatable source)

- Script: `solo-company-agent2-readonly-uat-v1.mjs --read-only`
- Source revision: `95f82aa57701bc6dc050190de6720790af8fca4e`
- WorkOrder: `solo-agent2-ops-uat-1793659468956`
- Result: `succeeded`, one attempt, two verification evidences, transitions `planning > ready > executing > verifying > succeeded`.
- Executed precisely the live authenticated, read-only `selfmaint_health` tool via Solo MCP host bridge and its `EngineeringAgent` class; no mutation allowlist, no production persisted work order, no daemon restart, no scheduling, no credential logging.
- Four protective tests (scoped capability, valid low-risk WorkOrder, denial of mutation/out-of-scope, explicit CLI switch) passed on the server. GitHub CI separately runs Node tests.
- THIS IS NOT a permanent scheduled agent or a claim of autonomous engineering production operation.

## Proposed role progression, in order

| Stage | Role | Capability | Allowed autonomy | Go/no-go |
|---|---|---|---|---|
| 1 | Operations Auditor | health, topology and approved read-only audit tools | L0, no writes | Live authenticated read-only UAT PASS; persist results only in an approved isolated journal |
| 2 | QA Verification Agent | fixed tests, code inspection, staging verification | L0/L1 | Explicit scope, schema-pinned tools, audit logs and bounded costs |
| 3 | Engineering Developer Agent | propose fixes via Git branch and tests; draft PR | L1/L2 and staging only | Immutable Git SHA, review gates, rollback proof, no direct production writes |
| 4 | Release Coordinator | promotion of reviewed artifacts | L3/L4 only through existing signed host authority | No automatic L4 approval; production release subject to separately authorized signed action |

## Missing implementation before permanent agent activation

1. **Read-only descriptor/adapter:** Existing `SshAgent2ExecutionAdapter` implements request/apply/status/verify for fixed Host Actions; it does not schedule ordinary read-only capability WorkOrders. Ship a separate, reviewed `ReadOnlyAgent2Adapter` with exact `readOnlyHint`, schema fingerprint, fixed capability and policy checks.
2. **Persistent WorkOrder queue & delivery:** Deterministic read-only work-order submission, idempotent storage, bounded retry, evidence sanitization, durable checkpoints, crash recovery and manual kill switch. Test in isolated staging before changing the dark-mode runtime.
3. **Agent planner:** No live LLM reasoning/planning component is currently configured. Add a bounded planner with explicit schema and per-project access, token/cost limits, human checkpoints and prompt-injection controls; never interpret MCP data as authority.
4. **Role-based scopes:** Bind distinct agent identities to scoped resources (begin with read-only PRHM infrastructure monitoring), not universal access to Agent2.
5. **Deployment:** Produce a new immutable release SHA, build/CI/security review, shadow UAT, audited promotion and rollback. The current operational release must remain unchanged until accepted.

**Safety:** No background schedules, live customer workloads, unrestricted shell, production writes, self-approval or changes to existing Root-of-Trust. Formal Universal Installer onboarding remains a separate open dependency tracked by PR #232.
