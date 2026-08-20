# Control Plane Bootstrap Root of Trust V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perform one externally-operated, SHA-bound bootstrap ceremony that installs and registers `control_plane_typed_bootstrap_transport_v1`, then permanently retires this operator bootstrap path for future package installs.

**Architecture:** No new reusable privileged API or Host Action is introduced. The authenticated root operator acts as the external root-of-trust exactly once: obtain the two immutable artifacts from commit `51027bc81f16840580b3ed5ca09d6c42f78dc044`, verify exact byte length/SHA-256 and syntax, run the existing registration bootstrap first in `--preflight-only`, require a fresh Level-4 confirmation, then run the exact same staged bootstrap with `--apply`. The registration bootstrap owns its own transactional rollback; the operator ceremony adds no broad cleanup or alternative remediation path.

**Tech Stack:** Linux root console/SSH, `sha256sum`, `stat`, `/usr/local/bin/prhm-node`, `curl` to immutable GitHub commit URLs, existing `bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js`, systemd/service health reads.

**Spec:** `docs/superpowers/specs/2026-08-20-control-plane-bootstrap-root-of-trust-v1-design.md`

## Global Constraints

- Repository: `prhmonline/prhm-host-actions`.
- Reviewed source commit: `51027bc81f16840580b3ed5ca09d6c42f78dc044`.
- Transport path: `control-plane-typed-bootstrap-transport-v1.js`.
- Transport byte length: `72854`.
- Transport SHA-256: `049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335`.
- Registration bootstrap path: `bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js`.
- Registration bootstrap byte length: `109634`.
- Registration bootstrap SHA-256: `d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e`.
- Embedded package id: `deployhq_control_adapter_node1_recreate_v1`.
- Embedded package manifest SHA-256: `aa3e87db8630b1fac0d8db1a6863a733563763bc39b8677f8af2a7e6088b7728`.
- Operator staging root: `/root/prhm-bootstrap-root-of-trust-v1-51027bc8`.
- Staging root must be mode `0700`, owned by `root:root`.
- Candidate files must be regular files, not symlinks.
- No `HEAD`, branch tip, mutable tag, `git pull`, `curl | bash`, `wget | sh`, request-supplied path, request-supplied command, request-supplied URL, secret input, credential input, DeployHQ mutation, Honartik mutation, iMotion mutation, or public MCP cutover is permitted.
- Preflight must perform zero production mutation and zero service restart.
- Apply requires a fresh literal `CONFIRM_LEVEL_4_CRITICAL`; prior confirmations cannot be reused.
- On any artifact or baseline drift, stop fail-closed and rebase guards explicitly; never disable SHA checks.
- Registration bootstrap rollback is authoritative for mutations it performs. The operator ceremony must not perform broad cleanup.
- After one verified successful bootstrap, this root-of-trust ceremony is retired for future package installs.

---

### Task 1: Immutable Artifact Acquisition

**Files:**
- Stage: `/root/prhm-bootstrap-root-of-trust-v1-51027bc8/control-plane-typed-bootstrap-transport-v1.js`
- Stage: `/root/prhm-bootstrap-root-of-trust-v1-51027bc8/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js`

**Interfaces:**
- Consumes: immutable GitHub commit `51027bc81f16840580b3ed5ca09d6c42f78dc044`.
- Produces: two unexecuted staged regular files whose byte lengths and SHA-256 values exactly match the spec.

- [ ] **Step 1: Create the fixed root-owned staging directory**

```bash
install -d -m 0700 -o root -g root /root/prhm-bootstrap-root-of-trust-v1-51027bc8
```

Expected: directory exists as `root:root`, mode `700`.

- [ ] **Step 2: Fetch the transport artifact from the immutable commit without executing it**

```bash
curl --fail --silent --show-error --location \
  --output /root/prhm-bootstrap-root-of-trust-v1-51027bc8/control-plane-typed-bootstrap-transport-v1.js \
  https://raw.githubusercontent.com/prhmonline/prhm-host-actions/51027bc81f16840580b3ed5ca09d6c42f78dc044/control-plane-typed-bootstrap-transport-v1.js
```

Expected: download succeeds; nothing is piped to a shell/interpreter.

- [ ] **Step 3: Fetch the registration bootstrap artifact from the immutable commit without executing it**

```bash
curl --fail --silent --show-error --location \
  --output /root/prhm-bootstrap-root-of-trust-v1-51027bc8/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js \
  https://raw.githubusercontent.com/prhmonline/prhm-host-actions/51027bc81f16840580b3ed5ca09d6c42f78dc044/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js
```

Expected: download succeeds; nothing is piped to a shell/interpreter.

- [ ] **Step 4: Lock staged file ownership and permissions**

```bash
chown root:root \
  /root/prhm-bootstrap-root-of-trust-v1-51027bc8/control-plane-typed-bootstrap-transport-v1.js \
  /root/prhm-bootstrap-root-of-trust-v1-51027bc8/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js
chmod 0600 \
  /root/prhm-bootstrap-root-of-trust-v1-51027bc8/control-plane-typed-bootstrap-transport-v1.js \
  /root/prhm-bootstrap-root-of-trust-v1-51027bc8/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js
```

Expected: both files are `root:root`, mode `600`.

- [ ] **Step 5: Verify both staged objects are regular files, not symlinks**

```bash
test -f /root/prhm-bootstrap-root-of-trust-v1-51027bc8/control-plane-typed-bootstrap-transport-v1.js
test ! -L /root/prhm-bootstrap-root-of-trust-v1-51027bc8/control-plane-typed-bootstrap-transport-v1.js
test -f /root/prhm-bootstrap-root-of-trust-v1-51027bc8/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js
test ! -L /root/prhm-bootstrap-root-of-trust-v1-51027bc8/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js
```

Expected: all four checks exit `0`.

---

### Task 2: Artifact Integrity and Syntax Gate

**Files:**
- Read: the two staged files from Task 1.

**Interfaces:**
- Consumes: staged artifacts.
- Produces: `ARTIFACT_GATE=PASS` only if sizes, SHA-256 values, syntax, and embedded immutable identities match exactly.

- [ ] **Step 1: Verify exact byte lengths**

```bash
test "$(stat -c '%s' /root/prhm-bootstrap-root-of-trust-v1-51027bc8/control-plane-typed-bootstrap-transport-v1.js)" = "72854"
test "$(stat -c '%s' /root/prhm-bootstrap-root-of-trust-v1-51027bc8/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js)" = "109634"
```

Expected: both checks exit `0`.

- [ ] **Step 2: Verify exact SHA-256 values**

```bash
echo '049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335  /root/prhm-bootstrap-root-of-trust-v1-51027bc8/control-plane-typed-bootstrap-transport-v1.js' | sha256sum -c -
echo 'd3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e  /root/prhm-bootstrap-root-of-trust-v1-51027bc8/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js' | sha256sum -c -
```

Expected: both lines report `OK`.

- [ ] **Step 3: Verify Node syntax without executing application logic**

```bash
/usr/local/bin/prhm-node --check /root/prhm-bootstrap-root-of-trust-v1-51027bc8/control-plane-typed-bootstrap-transport-v1.js
/usr/local/bin/prhm-node --check /root/prhm-bootstrap-root-of-trust-v1-51027bc8/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js
```

Expected: both commands exit `0` with no syntax error.

- [ ] **Step 4: Verify immutable identities are embedded in the candidate**

```bash
grep -F 'deployhq_control_adapter_node1_recreate_v1' /root/prhm-bootstrap-root-of-trust-v1-51027bc8/control-plane-typed-bootstrap-transport-v1.js
grep -F 'aa3e87db8630b1fac0d8db1a6863a733563763bc39b8677f8af2a7e6088b7728' /root/prhm-bootstrap-root-of-trust-v1-51027bc8/control-plane-typed-bootstrap-transport-v1.js
```

Expected: both fixed identities are present. Do not print any credential material.

- [ ] **Step 5: Stop immediately on any mismatch**

Expected operator outcome on any failed step:

```text
ARTIFACT_GATE=FAIL_CLOSED
APPLY_AUTHORIZED=false
PRODUCTION_MUTATION=false
```

---

### Task 3: Fresh Live Baseline and Topology Gate

**Files:**
- Read: `/opt/prhm-agent-selfmaint/server.js`
- Read: `/opt/prhm-agent-selfmaint-exec/server.js`
- Read: `/opt/prhm-company-control-plane/config/approval-policy.json`
- Read: `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`
- Read: `/opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js`

**Interfaces:**
- Consumes: current live Control Plane source/topology.
- Produces: exact fresh baseline evidence and a pass/fail comparison against the candidate's compiled guards.

- [ ] **Step 1: Capture all five live SHA-256 values immediately before preflight**

```bash
sha256sum \
  /opt/prhm-agent-selfmaint/server.js \
  /opt/prhm-agent-selfmaint-exec/server.js \
  /opt/prhm-company-control-plane/config/approval-policy.json \
  /home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js \
  /opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js
```

Last reviewed expected values:

```text
Base=c38bb88c5d7000eebedc5db758c7dd7d846b7b1a6df589c10f37237c3d1cce00
Executor=edaf10ace464cb70ea1625cb7998b2bae0112b46b1d4f383334ceeaf5b6a5108
Policy=162bfa045d9b600a48989dd88e4b367beff1272cbb9b83e1dbc5cf6bc8d6adad
MCP=c7be9c315319c893ee821268507577f10cb001440899f670659b2c3c7b26b722
ZDT=04a1416e837b1ae47e0a0ae72b5c1547d03118022c6c9ff19f392572ff7d38b4
```

If any value differs, do not continue; inspect compatibility and rebase the candidate guards in Git, rerun its full test suite, and restart this ceremony from Task 1.

- [ ] **Step 2: Verify public/Blue/Green MCP health without restarting anything**

```bash
curl -fsS http://127.0.0.1:8123/health >/dev/null
curl -fsS http://127.0.0.1:8124/health >/dev/null
curl -fsS http://127.0.0.1:8125/health >/dev/null
systemctl is-active prhm-agent-mcp-blue.service
systemctl is-active prhm-agent-mcp-green.service
systemctl is-active prhm-agent-mcp-router.service
```

Expected: three HTTP checks succeed and all three services report `active`.

- [ ] **Step 3: Verify Base/Executor/Approval services are healthy before mutation**

```bash
systemctl is-active prhm-agent-selfmaint.service
systemctl is-active prhm-agent-selfmaint-exec.service
systemctl is-active prhm-company-approval.service
```

Expected: all report `active`.

---

### Task 4: Operator Preflight-Only Ceremony

**Files:**
- Execute read-only candidate: `/root/prhm-bootstrap-root-of-trust-v1-51027bc8/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js`

**Interfaces:**
- Consumes: exact staged artifacts and fresh live baselines.
- Produces: preflight evidence proving candidate compatibility with zero production mutation.

- [ ] **Step 1: Reverify the bootstrap SHA immediately before execution**

```bash
echo 'd3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e  /root/prhm-bootstrap-root-of-trust-v1-51027bc8/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js' | sha256sum -c -
```

Expected: `OK`.

- [ ] **Step 2: Run only the supported preflight mode**

```bash
/usr/local/bin/prhm-node \
  /root/prhm-bootstrap-root-of-trust-v1-51027bc8/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js \
  --preflight-only
```

Expected evidence must include semantically equivalent assertions:

```text
ok=true
preflight_only=true
production_mutation=false
database_mutation=false
deployhq_mutation=false
honartik_mutation=false
imotion_mutation=false
mcp_cutover=false
```

- [ ] **Step 3: Recheck the five live SHA values after preflight**

Run the same `sha256sum` command from Task 3 Step 1.

Expected: values are byte-for-byte unchanged from the immediately preceding capture.

- [ ] **Step 4: Recheck all health endpoints/services after preflight**

Run Task 3 Steps 2 and 3 again.

Expected: all remain healthy/active; no service restart is required for preflight.

- [ ] **Step 5: Record the gate outcome**

Only if every previous step passed:

```text
ROOT_OF_TRUST_PREFLIGHT=PASS
SOURCE_COMMIT_MATCH=YES
TRANSPORT_SHA_MATCH=YES
REGISTRATION_BOOTSTRAP_SHA_MATCH=YES
MANIFEST_SHA_MATCH=YES
LIVE_BASELINES_MATCH=YES
NODE_SYNTAX=PASS
PRODUCTION_MUTATION=false
APPLY_AUTHORIZED=false
```

Stop here and obtain a fresh literal `CONFIRM_LEVEL_4_CRITICAL` before Task 5.

---

### Task 5: Fresh Level-4 Apply Ceremony

**Files:**
- Execute exact staged bootstrap from Task 4.

**Interfaces:**
- Consumes: successful Task 4 evidence plus one fresh Level-4 confirmation.
- Produces: registered typed bootstrap transport or a fail-closed/rolled-back result.

- [ ] **Step 1: Require one fresh confirmation scoped only to this ceremony**

Required literal confirmation:

```text
CONFIRM_LEVEL_4_CRITICAL
```

Do not reuse a confirmation from any prior Host Action, DeployHQ, MCP, Honartik, iMotion, or ZDT chain.

- [ ] **Step 2: Reverify both staged artifact SHA-256 values and sizes**

Repeat Task 2 Steps 1 and 2.

Expected: all checks pass exactly.

- [ ] **Step 3: Reverify all five live baseline SHA-256 values**

Repeat Task 3 Step 1.

Expected: still identical to the values used for successful preflight. Any drift cancels this confirmation and returns to compatibility review/rebase.

- [ ] **Step 4: Run only the exact fixed apply command**

```bash
/usr/local/bin/prhm-node \
  /root/prhm-bootstrap-root-of-trust-v1-51027bc8/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js \
  --apply
```

No other arguments are permitted.

- [ ] **Step 5: Capture the bootstrap result without adding remediation logic**

Expected success evidence must identify the registered transport and indicate no rollback. If the bootstrap reports failure, inspect its invocation-bound rollback evidence and stop. Do not manually overwrite files to force completion.

Expected success class:

```text
ok=true
installed=true
rollback_performed=false
production_site_mutation=false
database_mutation=false
deployhq_mutation=false
honartik_mutation=false
imotion_mutation=false
mcp_cutover=false
```

Failure class:

```text
ok=false
APPLY_CONTINUE=false
```

If bootstrap also reports `rollback_failed=true`, classify as critical and perform no broad automatic remediation.

---

### Task 6: Post-Install Verification and Root-of-Trust Retirement

**Files:**
- Read live Base/Executor/Policy/MCP/ZDT sources.
- Read installed typed transport helper/source/result paths produced by the registration bootstrap.

**Interfaces:**
- Consumes: Task 5 success result.
- Produces: bounded proof that transport is registered and the external operator bootstrap ceremony is retired.

- [ ] **Step 1: Verify Base/Executor/Approval services are healthy**

```bash
systemctl is-active prhm-agent-selfmaint.service
systemctl is-active prhm-agent-selfmaint-exec.service
systemctl is-active prhm-company-approval.service
```

Expected: all `active`.

- [ ] **Step 2: Verify public/Blue/Green MCP remain healthy without a direct cutover**

```bash
curl -fsS http://127.0.0.1:8123/health >/dev/null
curl -fsS http://127.0.0.1:8124/health >/dev/null
curl -fsS http://127.0.0.1:8125/health >/dev/null
systemctl is-active prhm-agent-mcp-blue.service
systemctl is-active prhm-agent-mcp-green.service
systemctl is-active prhm-agent-mcp-router.service
```

Expected: all healthy/active. The ceremony itself must not perform public MCP cutover.

- [ ] **Step 3: Verify the transport action is present in live source registries**

```bash
grep -F 'control_plane_typed_bootstrap_transport_v1' /opt/prhm-agent-selfmaint/server.js
grep -F 'control_plane_typed_bootstrap_transport_v1' /opt/prhm-agent-selfmaint-exec/server.js
grep -F 'control_plane_typed_bootstrap_transport_v1' /home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js
```

Expected: action/operation registration is present in all required live source surfaces.

- [ ] **Step 4: Verify the V16 pending-status semantics remain present**

```bash
grep -F "status:'pending'" /opt/prhm-agent-selfmaint-exec/server.js
grep -F 'host_action_v2_request_expired' /opt/prhm-agent-selfmaint-exec/server.js
```

Expected: both anchors remain present.

- [ ] **Step 5: Verify no DeployHQ operation occurred during this ceremony**

Expected evidence from the bootstrap/transport registration result:

```text
DEPLOYHQ_MUTATION=false
NODE1_RECREATED=false
DEPLOYMENT_EXECUTED=false
COMMAND_EXECUTED=false
```

- [ ] **Step 6: Retire this external bootstrap ceremony**

Record the terminal state in the operational evidence/report:

```text
ROOT_OF_TRUST_STATE=RETIRED
ROOT_OF_TRUST_REUSE_FOR_FUTURE_PACKAGES=NO
FUTURE_PACKAGE_PATH=control_plane_typed_bootstrap_transport_v1
```

Do not delete the reviewed spec/plan or bootstrap evidence; they remain audit artifacts. Future package installs must use the newly registered typed transport and require their own typed request plus fresh Level-4 confirmation.

- [ ] **Step 7: Remove staged copies only after all verification passes**

```bash
rm -f -- \
  /root/prhm-bootstrap-root-of-trust-v1-51027bc8/control-plane-typed-bootstrap-transport-v1.js \
  /root/prhm-bootstrap-root-of-trust-v1-51027bc8/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js
rmdir /root/prhm-bootstrap-root-of-trust-v1-51027bc8
```

Expected: only the two ceremony staging files and now-empty staging directory are removed. No installed transport/control-plane file is removed.

---

## Execution Boundary

This plan is documentation only until explicitly executed. The next live sequence is:

```text
1. Execute Tasks 1-4 only (operator preflight)
2. Report exact evidence
3. Obtain fresh CONFIRM_LEVEL_4_CRITICAL
4. Execute Task 5
5. Execute Task 6 verification/retirement
6. Perform any required MCP schema exposure through its separately-approved rolling path
7. Create a typed transport request for the DeployHQ adapter package
8. Obtain a separate fresh Level-4 for that package install
```

No confirmation in this plan authorizes node1 recreation, DeployHQ adapter package application, Blue V4 cutover, Honartik cleanup, iMotion target registration, or any unrelated production change.
