# Production Git Reconciliation V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fixed, read-only Host Action named `production_git_reconciliation_v1` that reports deployed Git state for allowlisted Production projects without mutating repositories, services, files, databases, network state, or deployment state.

**Architecture:** Implement a closed `project_id` registry in `prhm-host-actions`, a narrow executor that runs only fixed read-only Git observations against registry-defined paths, and a registration/bootstrap layer that exposes the action through the existing Host Actions framework. GitHub authoritative HEAD comparison remains outside the action. Runtime action stays read-only; installation/registration remains a separately approved Production mutation.

**Tech Stack:** Node.js (existing Host Actions/bootstrap conventions), shelling only through fixed internal command templates, Git CLI read-only commands, existing repository test conventions, GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-09-16-production-git-reconciliation-v1-design.md`

## Global Constraints

- Runtime input is only a closed enum `project_id`.
- No arbitrary shell, arbitrary path, arbitrary repository, host, branch, or command input.
- No `git fetch`, `pull`, `checkout`, `reset`, `clean`, `stash`, `commit`, `push`, `merge`, or `rebase` in V1.
- No file writes, package installs, migrations, service restarts, DB operations, or deployment actions.
- Never return filenames, diffs, file contents, `.env` values, secrets, authenticated remote URLs, tokens, SSH private data, or secret-bearing environment values.
- Raw `remote.origin.url` must be sanitized to canonical `owner/repo` or fail closed.
- Unknown/misconfigured targets return structured `UNKNOWN`/error; the action never self-repairs.
- `git fetch` is excluded; local ahead/behind is explicitly against the existing local remote-tracking ref only.
- GitHub authoritative HEAD is read independently by the GitHub connector and compared outside this action.
- Installation/registration on Production requires a fresh governed approval and must not reuse an old approval.
- Initial target mappings may be enabled only when exact Production path and canonical repository identity are proven; guessed mappings stay disabled.

---

## File Structure

The implementation should follow existing fixed-action/bootstrap patterns already present in `prhm-host-actions`. Before writing code, the implementer must inspect the closest current read-only Host Action and bootstrap/registration pair and preserve that repository convention. The target responsibilities are:

- `production-git-reconciliation-v1.js` — pure reconciliation executor: registry lookup, fixed Git observations, parsing, sanitization, classification, bounded structured output.
- `bootstrap-production-git-reconciliation-v1.js` — repository-side bootstrap/registration package using the existing Host Actions installation convention; no Production execution during repository implementation.
- `tests/production-git-reconciliation-v1.test.js` — behavioral contract for registry, parsing, classification, sanitization, fail-closed cases, and forbidden command surface.
- `tests/bootstrap-production-git-reconciliation-v1.test.js` — repository/bootstrap contract proving fixed action identity, input schema, read-only metadata, SHA binding/registration expectations, and absence of arbitrary inputs.
- `docs/runbooks/production-git-reconciliation-v1.md` — operator runbook: purpose, approved inputs, exact output interpretation, Production installation gate, rollback/removal notes, and Phase 3B usage.

If the current repository convention uses different exact directories for executor/bootstrap tests, keep the same responsibilities but place files beside the nearest analogous action. Do not restructure unrelated code.

---

### Task 1: Lock the Existing Host Actions Pattern

**Files:**
- Read: nearest existing read-only fixed action and its bootstrap/registration file
- Read: its corresponding tests
- Create/modify: none in this task

**Interfaces:**
- Consumes: current Host Actions executor/registration contract
- Produces: exact filenames, exported function shape, action metadata shape, test runner command, and registration mechanism used by subsequent tasks

- [ ] **Step 1: Identify the nearest fixed read-only action**

Search the repository for actions that satisfy all of these properties: closed input schema, fixed command surface, structured JSON output, no arbitrary shell, and explicit Host Actions registration metadata.

Run:
```bash
git grep -n "read-only\|readonly\|inputSchema\|action_id\|host action" -- '*.js' 'tests/*.js' 'docs/runbooks/*.md'
```

Expected: at least one existing action/bootstrap/test family that can be used as the structural template.

- [ ] **Step 2: Record the exact repository convention in implementation notes**

Before coding, note locally which existing files are the selected analog and record:

```text
EXECUTOR_ANALOG=<path>
BOOTSTRAP_ANALOG=<path>
EXECUTOR_TEST_ANALOG=<path>
BOOTSTRAP_TEST_ANALOG=<path>
TEST_COMMAND=<exact command>
```

Do not commit these temporary notes.

- [ ] **Step 3: Verify baseline tests are green**

Run the repository's existing focused tests for the selected analog, then the repository's normal test command if practical.

Expected: PASS before new implementation begins. If baseline is red, stop and report the existing failure instead of mixing it with this feature.

- [ ] **Step 4: No commit**

This task is discovery-only.

---

### Task 2: Define the Closed Project Registry and Target Validation

**Files:**
- Create: `production-git-reconciliation-v1.js`
- Test: `tests/production-git-reconciliation-v1.test.js`

**Interfaces:**
- Consumes: one `project_id` string from the registered enum
- Produces: `resolveTarget(projectId)` returning immutable target metadata or a structured fail-closed error

Target metadata type:

```js
{
  project_id: 'honartik_front_prod',
  repository_root: '/verified/fixed/path',
  expected_origin_repo: 'prhmonline/Honar-front-new',
  expected_branch: 'main',
  expected_upstream: 'origin/main',
  enabled: true
}
```

For unproven mappings, either omit the enum entry or set `enabled: false`; disabled targets must not reach Git execution.

- [ ] **Step 1: Write failing registry tests**

Add tests covering:

```js
assert.throws(() => resolveTarget('unknown_target'), /unknown_project_id/)
assert.throws(() => resolveTarget('disabled_target'), /target_not_enabled/)
const target = resolveTarget('honartik_front_prod')
assert.equal(target.project_id, 'honartik_front_prod')
assert.equal(Object.isFrozen(target), true)
```

The test fixture for `honartik_front_prod` may use a verified fixture mapping only in tests; Production path values must not be invented in the production registry.

- [ ] **Step 2: Run the focused test and verify RED**

Run the repository's selected test command for `tests/production-git-reconciliation-v1.test.js`.

Expected: FAIL because `resolveTarget` does not yet exist.

- [ ] **Step 3: Implement the minimal closed registry**

Implement:

```js
function resolveTarget(projectId) {
  if (typeof projectId !== 'string') throw fail('invalid_project_id')
  const target = TARGETS[projectId]
  if (!target) throw fail('unknown_project_id')
  if (!target.enabled) throw fail('target_not_enabled')
  return Object.freeze({ ...target })
}
```

The registry must be declared in code, not loaded from caller-controlled JSON/env/path input.

- [ ] **Step 4: Run focused tests and verify GREEN**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add production-git-reconciliation-v1.js tests/production-git-reconciliation-v1.test.js
git commit -m "feat: add fixed production git reconciliation registry"
```

---

### Task 3: Implement Remote Sanitization Without Credential Leakage

**Files:**
- Modify: `production-git-reconciliation-v1.js`
- Modify: `tests/production-git-reconciliation-v1.test.js`

**Interfaces:**
- Consumes: raw remote string read internally from Git config
- Produces: `sanitizeOriginRepo(rawUrl)` returning canonical `owner/repo` or throwing `unsafe_or_unrecognized_origin`

Supported examples:

```text
git@github.com:prhmonline/Honar-front-new.git -> prhmonline/Honar-front-new
ssh://git@github.com/prhmonline/Honar-front-new.git -> prhmonline/Honar-front-new
https://github.com/prhmonline/Honar-front-new.git -> prhmonline/Honar-front-new
https://user:SECRET@github.com/prhmonline/Honar-front-new.git -> prhmonline/Honar-front-new
```

- [ ] **Step 1: Write failing sanitization tests**

Include HTTPS, SCP-like SSH, `ssh://`, token-bearing HTTPS, malformed URL, non-GitHub host, and query/fragment cases. Add an explicit assertion that the serialized result never contains a fixture secret such as `TOP_SECRET_TOKEN`.

- [ ] **Step 2: Run tests and verify RED**

Expected: FAIL because sanitizer is absent.

- [ ] **Step 3: Implement strict sanitizer**

Implementation must parse/normalize only recognized GitHub forms, strip `.git`, reject path traversal or extra path segments, and return only `owner/repo`.

- [ ] **Step 4: Verify GREEN and run a secret-leak grep against test output**

Expected: PASS; fixture secret absent.

- [ ] **Step 5: Commit**

```bash
git add production-git-reconciliation-v1.js tests/production-git-reconciliation-v1.test.js
git commit -m "feat: sanitize git origin identity"
```

---

### Task 4: Build the Fixed Read-Only Git Probe

**Files:**
- Modify: `production-git-reconciliation-v1.js`
- Modify: `tests/production-git-reconciliation-v1.test.js`

**Interfaces:**
- Consumes: immutable target metadata from `resolveTarget`
- Produces: `probeRepository(target, execGit)` returning sanitized observation data

Observation shape:

```js
{
  is_git_repository: true,
  branch: 'main',
  head_sha: '<40-hex>',
  origin_repo: 'prhmonline/Honar-front-new',
  upstream_branch: 'origin/main',
  dirty: false,
  tracked_modified_count: 0,
  untracked_count: 0,
  ahead: 0,
  behind: 0,
  detached_head: false,
  remote_tracking_freshness: 'unknown'
}
```

- [ ] **Step 1: Write a fake fixed-command executor and failing probe tests**

The test fake must only recognize the exact allowed Git observations. Any unexpected command must throw so tests prove there is no hidden extra command surface.

Expected fixed operations:

```text
rev-parse --is-inside-work-tree
rev-parse HEAD
symbolic-ref --short HEAD
status --porcelain=v1 -z
config --get remote.origin.url
rev-parse --verify <fixed upstream>
rev-list --left-right --count <fixed upstream>...HEAD
```

- [ ] **Step 2: Add dirty-tree parsing tests**

Fixtures must cover tracked modified/deleted/renamed records and untracked records using NUL-delimited porcelain input. Assert counts only and assert no filename appears in result JSON.

- [ ] **Step 3: Add detached/missing-upstream/unsafe-ownership/timeout/error tests**

Each case must return or throw the precise fail-closed classification required by the spec; none may trigger repair commands.

- [ ] **Step 4: Run focused tests and verify RED**

Expected: FAIL because probe implementation is absent.

- [ ] **Step 5: Implement minimal fixed probe**

Use `spawn`/`execFile`-style argv invocation rather than concatenated shell strings if that matches repository conventions. Working directory must come only from resolved registry metadata. Set bounded timeout and output limits using the existing Host Actions pattern.

- [ ] **Step 6: Run focused tests and verify GREEN**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add production-git-reconciliation-v1.js tests/production-git-reconciliation-v1.test.js
git commit -m "feat: add read-only production git probe"
```

---

### Task 5: Add Deterministic Classification and Structured Output

**Files:**
- Modify: `production-git-reconciliation-v1.js`
- Modify: `tests/production-git-reconciliation-v1.test.js`

**Interfaces:**
- Consumes: probe observation
- Produces: `classifyLocalTracking(observation)` and final action result

Classification precedence:

```text
DIRTY > DETACHED > UNKNOWN > DIVERGED_LOCAL_TRACKING > AHEAD_LOCAL_TRACKING > BEHIND_LOCAL_TRACKING > MATCH_LOCAL_TRACKING
```

- [ ] **Step 1: Write failing classification tests**

Cover exact combinations:

```js
{ dirty: true, ahead: 0, behind: 0 } => 'DIRTY'
{ dirty: false, detached_head: true } => 'DETACHED'
{ dirty: false, ahead: 0, behind: 0 } => 'MATCH_LOCAL_TRACKING'
{ dirty: false, ahead: 1, behind: 0 } => 'AHEAD_LOCAL_TRACKING'
{ dirty: false, ahead: 0, behind: 2 } => 'BEHIND_LOCAL_TRACKING'
{ dirty: false, ahead: 1, behind: 2 } => 'DIVERGED_LOCAL_TRACKING'
```

- [ ] **Step 2: Verify RED**

Expected: FAIL because classifier/final shape is absent.

- [ ] **Step 3: Implement classifier and final result**

Final result must contain exactly the approved fields from the spec plus structured error fields when `ok:false`. It must not include raw stdout/stderr, filenames, commands, environment, or raw origin URL.

- [ ] **Step 4: Add output allowlist test**

Assert `Object.keys(result)` is a subset of the approved output-key set.

- [ ] **Step 5: Verify GREEN**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add production-git-reconciliation-v1.js tests/production-git-reconciliation-v1.test.js
git commit -m "feat: classify production git reconciliation state"
```

---

### Task 6: Prove the Executor Cannot Mutate Git or Escape the Registry

**Files:**
- Modify: `tests/production-git-reconciliation-v1.test.js`
- Modify: `production-git-reconciliation-v1.js` only if tests expose a defect

**Interfaces:**
- Consumes: complete executor source/behavior
- Produces: security contract proving no write-capable Git command, arbitrary shell, or arbitrary path escape exists

- [ ] **Step 1: Add forbidden-command source assertions**

Read the executor source in the test and assert forbidden command tokens are absent from executable command definitions:

```text
fetch pull checkout reset clean stash commit push merge rebase config --add config --global
```

The test may allow these words inside comments/error messages only if parsing distinguishes executable command definitions; simplest safe implementation is to keep them out of executor command tables entirely.

- [ ] **Step 2: Add hostile-input tests**

Try values such as:

```text
../../etc
honartik_front_prod;rm -rf /
$(id)
/home/prhm/...
https://evil.example/repo.git
```

All must fail at project-id validation before any command fake is invoked.

- [ ] **Step 3: Add side-effect filesystem test using a temporary fixture repo**

Capture a recursive metadata snapshot (paths + content hashes for files created by the fixture) before and after the probe. Ignore normal Git access-time semantics if the platform changes atime; assert file content, index, refs, config, working-tree contents, and HEAD are unchanged.

- [ ] **Step 4: Run tests and verify GREEN**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/production-git-reconciliation-v1.test.js production-git-reconciliation-v1.js
git commit -m "test: prove git reconciliation action is read only"
```

---

### Task 7: Add Host Actions Bootstrap and Registration Contract

**Files:**
- Create: `bootstrap-production-git-reconciliation-v1.js`
- Create: `tests/bootstrap-production-git-reconciliation-v1.test.js`
- Modify: existing registration manifest only if the selected repository convention requires a source-side manifest update

**Interfaces:**
- Consumes: executor source and existing Host Actions bootstrap framework
- Produces: repository artifact capable of later governed registration of action id `production_git_reconciliation_v1`

Input schema must be equivalent to:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["project_id"],
  "properties": {
    "project_id": {
      "type": "string",
      "enum": ["<enabled proven targets only>"]
    }
  }
}
```

- [ ] **Step 1: Write failing bootstrap contract test**

Assert exact action id, read-only risk/approval metadata according to framework convention, `additionalProperties:false`, one required field, no path/shell/command inputs, executor SHA binding if framework supports it, and no automatic Production execution.

- [ ] **Step 2: Verify RED**

Expected: FAIL because bootstrap file does not exist.

- [ ] **Step 3: Implement bootstrap/registration package**

Follow the selected analog exactly for packaging, checksums, schema normalization, and registration request generation. Do not embed credentials or Production approval material.

- [ ] **Step 4: Verify bootstrap tests GREEN**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bootstrap-production-git-reconciliation-v1.js tests/bootstrap-production-git-reconciliation-v1.test.js
git commit -m "feat: package production git reconciliation host action"
```

---

### Task 8: Verify and Enable Only Proven Production Target Mappings

**Files:**
- Modify: `production-git-reconciliation-v1.js`
- Modify: `tests/production-git-reconciliation-v1.test.js`
- Modify: `bootstrap-production-git-reconciliation-v1.js` if enum is generated there

**Interfaces:**
- Consumes: read-only preflight evidence for exact Production roots and canonical repository identities
- Produces: final enabled enum containing only proven targets

- [ ] **Step 1: Gather path/repository evidence without mutating Production**

Use the preferred server execution path available at execution time (Mohammad SSH Agent 2 when exposed; otherwise an already-approved fixed read-only evidence channel). For each candidate target, collect only:

```text
logical project id
exact repository root
whether .git/worktree is valid
sanitized origin identity
expected branch/upstream if present
```

Do not use manual SSH unless all governed connector paths fail.

- [ ] **Step 2: Reject ambiguous mappings**

Specifically, do not guess PBCinema mappings from `cfpark-back-new`; only enable `pbcinema_*` when Production root and origin prove that identity relationship.

- [ ] **Step 3: Update registry with proven fixed values only**

Unproven targets remain absent/disabled.

- [ ] **Step 4: Update enum tests to equal the proven target set exactly**

- [ ] **Step 5: Run focused tests GREEN**

Expected: PASS.

- [ ] **Step 6: Commit evidence-bound registry update**

```bash
git add production-git-reconciliation-v1.js bootstrap-production-git-reconciliation-v1.js tests/production-git-reconciliation-v1.test.js
git commit -m "chore: bind reconciliation targets to verified production mappings"
```

---

### Task 9: Add Operator Runbook and Phase 3B Interpretation Rules

**Files:**
- Create: `docs/runbooks/production-git-reconciliation-v1.md`

**Interfaces:**
- Consumes: final action contract
- Produces: operator instructions for later approved installation and read-only execution

- [ ] **Step 1: Write the runbook**

It must document:

```text
Purpose
Action ID
Allowed project_id values
Read-only guarantees
No-fetch limitation
Output fields
Meaning of local classifications
How GitHub HEAD is obtained separately
External final classification rules
Failure handling
Approval boundary for installation/registration
Rollback/removal procedure for the capability itself
Explicit statement: mismatch never triggers automatic repair/deploy
```

- [ ] **Step 2: Add example sanitized output**

Use fake paths/SHAs; do not put secrets or live credential material in docs.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/production-git-reconciliation-v1.md
git commit -m "docs: add production git reconciliation runbook"
```

---

### Task 10: Run Full Repository Verification and Security Review

**Files:**
- Modify only if verification exposes defects

**Interfaces:**
- Consumes: all implementation artifacts
- Produces: repository-ready, uninstalled implementation with evidence that tests and static checks pass

- [ ] **Step 1: Run focused executor and bootstrap tests**

Run the exact test commands determined in Task 1.

Expected: all production-git-reconciliation tests PASS.

- [ ] **Step 2: Run repository-wide test/lint/static checks used by CI**

Expected: PASS. If unrelated baseline failures exist, clearly separate them with evidence.

- [ ] **Step 3: Search the implementation for forbidden surfaces**

Run:

```bash
git grep -nE "git (fetch|pull|checkout|reset|clean|stash|commit|push|merge|rebase)|rm -|sudo|systemctl|service |child_process.*shell[[:space:]]*:[[:space:]]*true" -- production-git-reconciliation-v1.js bootstrap-production-git-reconciliation-v1.js tests/production-git-reconciliation-v1.test.js tests/bootstrap-production-git-reconciliation-v1.test.js
```

Expected: no executable forbidden surface. Test strings documenting forbidden cases are acceptable only when review confirms they are assertions, not runtime commands.

- [ ] **Step 4: Review diff from branch base**

Run:

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git diff main...HEAD -- production-git-reconciliation-v1.js bootstrap-production-git-reconciliation-v1.js tests/production-git-reconciliation-v1.test.js tests/bootstrap-production-git-reconciliation-v1.test.js docs/runbooks/production-git-reconciliation-v1.md
```

Expected: only intended feature/spec/plan/runbook files and any strictly required registration manifest change.

- [ ] **Step 5: Commit any verification-only fixes**

Use a specific commit message such as:

```bash
git commit -am "fix: close reconciliation verification gaps"
```

Only if changes were actually required.

---

### Task 11: Open a Draft PR — No Production Installation

**Files:**
- GitHub metadata only

**Interfaces:**
- Consumes: verified implementation branch
- Produces: Draft PR for repository review; no merge, deploy, or registration

- [ ] **Step 1: Push branch if implementation occurred in an isolated worktree**

Push only the feature branch; never force-push.

- [ ] **Step 2: Open Draft PR**

Title:

```text
feat: add fixed read-only production Git reconciliation action
```

PR body must state:

```text
- repository implementation only
- Production not modified
- action not registered on Production
- runtime is read-only
- installation requires fresh governed approval
- enabled targets are limited to mappings proven in preflight
- git fetch is intentionally excluded from V1
```

- [ ] **Step 3: Confirm CI/checks on the PR**

Do not mark ready or merge solely because CI passes.

- [ ] **Step 4: Stop at the Production approval gate**

At this point report exact implementation commit SHA, test evidence, PR number, enabled target set, and proposed Production registration mutation. Obtain a fresh explicit approval before any Host Action installation/registration.

---

### Task 12: Separately Governed Production Registration and Read-Only Phase 3B Execution

**Files:**
- Production control-plane state only after explicit approval

**Interfaces:**
- Consumes: reviewed executor/bootstrap SHA and fresh approval
- Produces: registered read-only action plus Phase 3B reconciliation rows

- [ ] **Step 1: Bind the registration request to the reviewed executor/bootstrap SHA**

The request must fail if source SHA moved.

- [ ] **Step 2: Capture preimage/registration state and rollback path**

Use the existing Host Actions governance mechanism.

- [ ] **Step 3: Install/register only the fixed action**

No unrelated Agent/Control Plane update is bundled into this change.

- [ ] **Step 4: Verify action schema after registration**

Confirm exact action id, enum, no extra properties, read-only metadata, and expected executor SHA.

- [ ] **Step 5: Execute one low-risk target first**

Run one known clean target. Verify output contains only approved metadata and no filenames/raw origin/secret data.

- [ ] **Step 6: Execute remaining enabled targets read-only**

Collect one structured result per target.

- [ ] **Step 7: Compare each Production HEAD with GitHub authoritative HEAD**

Use GitHub connector ancestry/commit comparison to assign final external state:

```text
MATCH
BEHIND
AHEAD
DIVERGED
DIRTY
UNKNOWN
```

- [ ] **Step 8: Produce the Phase 3B reconciliation table and stop**

No mismatch triggers sync, repair, cleanup, merge, or deploy. All non-MATCH rows proceed to Phase 3C Risk Classification.
