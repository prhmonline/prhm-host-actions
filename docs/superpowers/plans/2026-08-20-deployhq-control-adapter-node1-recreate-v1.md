# DeployHQ Control Adapter + Node1 Canonical Recreate V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a localhost-only DeployHQ control adapter with systemd credential isolation, then register a Level-4 typed Host Action that idempotently recreates only the canonical `PRHM Host Bootstrap - node1` target.

**Architecture:** The adapter owns DeployHQ authentication and exposes three fixed node1 operations on loopback. The Host Action owns approval, duplicate/conflict checks, side-effect verification and rollback journal, but never sees the DeployHQ credential or a generic DeployHQ API primitive.

**Tech Stack:** Node.js 20, built-in `http`/`https`, systemd service hardening and `LoadCredential`, existing Host Action v2 Base/Executor/approval/MCP registration pattern.

**Spec:** `docs/superpowers/specs/2026-08-20-deployhq-node1-canonical-recreate-typed-action-v1-design.md`

## Global Constraints

- Fixed DeployHQ project: `prhm-host-actions`.
- Fixed canonical target: `PRHM Host Bootstrap - node1`, `185.191.76.138:22022`, `root`, `/root`, `main`, SSH, `auto_deploy=false`.
- Adapter listens on loopback only and exposes no generic proxy/API path.
- Credential comes only from `${CREDENTIALS_DIRECTORY}/deployhq_token`; never from request body, argv, repo or chat.
- No deployment, SSH command or config-file deployment may be created/executed.
- TEMP Honartik targets/commands are immutable in this project.
- Adapter install and Host Action apply are separate fresh Level-4 gates.

---

### Task 1: Adapter core contract

**Files:**
- Create: `deployhq-control-adapter-v1.js`
- Test: `test-deployhq-control-adapter-v1.js`

**Interfaces:**
- Produces: `FIXED_NODE1`, `normalizeServer(server)`, `classifyCanonical(servers)`, `createAdapter(deps)`, `redact(value)`.
- `deps` contains typed functions only: `listServers()`, `createFixedServer()`, `deleteCreatedServer(identifier)`, `deploymentSnapshot()`, `commandSnapshot()`.

- [ ] **Step 1: Write failing contract tests** covering exact duplicate idempotency, same-name wrong-config conflict, fixed create, forbidden override body, unknown route/method, no deployment/command side effect, TEMP Honartik immutability and output redaction.
- [ ] **Step 2: Run** `node --test test-deployhq-control-adapter-v1.js`; expected RED because module is absent.
- [ ] **Step 3: Implement minimal pure adapter core** using only Node built-ins; no network code and no shell.
- [ ] **Step 4: Run** `node --check deployhq-control-adapter-v1.js && node --test test-deployhq-control-adapter-v1.js`; expected PASS.
- [ ] **Step 5: Commit** `feat: add fixed DeployHQ control adapter core`.

### Task 2: DeployHQ HTTPS client and credential boundary

**Files:**
- Modify: `deployhq-control-adapter-v1.js`
- Create: `test-deployhq-control-credential-v1.js`

**Interfaces:**
- Produces: `credentialPath(env)`, `credentialEvidence(buf)`, `createDeployHQClient({token, request})`.
- Client exposes only `listServers`, `createFixedServer`, `deleteCreatedServer`, `deploymentSnapshot`, `commandSnapshot`.

- [ ] **Step 1: Write failing tests** asserting credential path is `${CREDENTIALS_DIRECTORY}/deployhq_token`, missing credential disables mutation, evidence returns present/length/12-hex fingerprint only, Authorization/token never appears in output/errors, and the client rejects non-fixed API operations.
- [ ] **Step 2: Run tests** and verify RED for missing functions.
- [ ] **Step 3: Implement minimal HTTPS client** with fixed DeployHQ API origin/project paths, request timeout, bounded response size and token redaction.
- [ ] **Step 4: Run all adapter tests**; expected PASS.
- [ ] **Step 5: Commit** `feat: add DeployHQ credential-bound client`.

### Task 3: Loopback server and systemd hardening bootstrap

**Files:**
- Create: `bootstrap-deployhq-control-adapter-v1.js`
- Create: `test-deployhq-control-bootstrap-v1.js`

**Interfaces:**
- Installs executable: `/opt/prhm-deployhq-control/server.js`.
- Installs unit: `/etc/systemd/system/prhm-deployhq-control.service`.
- Fixed listener: `127.0.0.1:8791`.
- Unit consumes `LoadCredential=deployhq_token:<root-only-source>`; source path is metadata-only and never embedded with a secret value.

- [ ] **Step 1: Write failing tests** for loopback bind, `LoadCredential`, `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, `ProtectHome=true`, bounded writable state, no `Environment=...TOKEN`, preflight-only no mutation, and fail-closed missing credential source.
- [ ] **Step 2: Run tests**; expected RED because bootstrap is absent.
- [ ] **Step 3: Implement bootstrap** with `--preflight-only` and atomic file/unit install + rollback journal.
- [ ] **Step 4: Run syntax/tests**; expected PASS.
- [ ] **Step 5: Commit** `feat: add DeployHQ control adapter installer`.

### Task 4: Typed node1 recreate action helper

**Files:**
- Create: `deployhq-node1-canonical-recreate-v1.js`
- Create: `test-deployhq-node1-canonical-recreate-v1.js`

**Interfaces:**
- Calls only fixed localhost adapter URL.
- Produces preflight/apply evidence fields from the approved spec.

- [ ] **Step 1: Write failing tests** for clean create, exact duplicate, conflicting duplicate, create failure, read-back mismatch rollback, rollback failure, TEMP target drift, deployment side effect, command side effect, and absence of direct DeployHQ hostname/token/API code.
- [ ] **Step 2: Run tests**; expected RED.
- [ ] **Step 3: Implement minimal typed helper** with adapter-only calls and action-local rollback.
- [ ] **Step 4: Run syntax/tests**; expected PASS.
- [ ] **Step 5: Commit** `feat: add typed node1 canonical recreate action`.

### Task 5: Host Action v2 registration bootstrap

**Files:**
- Create: `bootstrap-host-actions-deployhq-node1-recreate-v1.js`
- Create: `test-host-actions-deployhq-node1-recreate-v1.js`

**Interfaces:**
- Registers `deployhq_node1_canonical_recreate_v1` in Base/Executor/approval policy/MCP schema using fixed empty input schema.
- Risk `critical`, environment `production`, Level-4 confirmation required.

- [ ] **Step 1: Write failing registration tests** against source transforms and baseline SHA binding.
- [ ] **Step 2: Run tests**; expected RED.
- [ ] **Step 3: Implement minimal installer** with `--preflight-only`, backups, rollback and no runtime restart.
- [ ] **Step 4: Run all project tests for these artifacts**; expected PASS.
- [ ] **Step 5: Commit** `feat: register DeployHQ node1 recreate host action`.

### Task 6: Live preflight gates

- [ ] **Step 1:** Read live SHA/service baselines.
- [ ] **Step 2:** Run adapter installer `--preflight-only`; require `production_mutation=false`.
- [ ] **Step 3:** Run Host Action registration installer `--preflight-only`; require all SHA/registry/policy gates PASS.
- [ ] **Step 4:** Verify credential presence only as `present/length/fingerprint`; do not print value. If absent, stop at `DEPLOYHQ_CREDENTIAL_PROVISION_GATE_V1`.
- [ ] **Step 5:** Record exact next Level-4 gate; do not install automatically.

### Task 7: Controlled production install and execution

- [ ] **Step 1:** Obtain fresh Level-4 for adapter install; install and verify localhost health.
- [ ] **Step 2:** Obtain separate fresh Level-4 for Host Action registration; install and refresh MCP runtime only through the existing rolling ZDT path if schema refresh is required.
- [ ] **Step 3:** Create a fresh Host Action v2 request; verify pending status.
- [ ] **Step 4:** Obtain a third fresh Level-4 bound to that request; apply exactly once.
- [ ] **Step 5:** Read back DeployHQ inventory and assert canonical config, unchanged TEMP Honartik identifiers, no new deployment, and no command execution.
- [ ] **Step 6:** Only after all PASS, resume the separately approved Blue V4 MCP cutover workflow.
