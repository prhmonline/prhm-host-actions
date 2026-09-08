# Honartik iTicket Pre-Token Preparation V1 Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with TDD and verify every gate before proceeding.

**Goal:** Make Honartik technically ready for iTicket token insertion while keeping the real token absent and the live application untouched.

**Architecture:** A fixed Level-3 Host Action prepares a current-baseline linked worktree, replaces the legacy provider with a dark-by-default secret-backed provider, adds a standalone contract test, commits/pushes exactly those files, and leaves production unchanged.

**Tech Stack:** Yii2/PHP 8.3, Node.js Host Actions v2, Git linked worktrees, systemd transient sandbox.

**Spec:** `docs/superpowers/specs/2026-09-07-honartik-iticket-pretoken-design.md`

## Global Constraints

- Real iTicket token must not be read, stored, logged, committed, or transmitted.
- Production backend HEAD must remain `1eb4335da14f9eacf23b9d5fd4288c133786386c` during preparation.
- Existing production `Event.php` overlay must remain unchanged.
- Only the provider and its contract test may change in the isolated iTicket worktree.
- No database mutation, live deploy, or external iTicket request is allowed.

---

### Task 1: Provider contract

**Files:**
- Modify in isolated worktree: `app/components/external/base.php`
- Create in isolated worktree: `app/components/external/tests/IticketExternalProviderTest.php`

- [x] Write a failing contract proving the legacy provider lacks secret-safe status/injected transport behavior.
- [x] Verify RED against the legacy implementation.
- [x] Implement dark-by-default secret-backed configuration and injectable transport while preserving all existing public provider methods.
- [x] Verify secret redaction, zero transport calls while disabled, seller Bearer profile, partner header profile, normalized failures, HTTPS-only URL, no redirects, 5-second connect timeout and 15-second total timeout.

### Task 2: Fixed helper

**Files:**
- Create: `honartik-iticket-pretoken-prepare-v1.js`
- Test: `test-honartik-iticket-pretoken-prepare-v1.js`

- [x] Write RED helper test before helper exists.
- [x] Implement exact production/worktree/branch/provider/origin bindings.
- [x] Implement isolated worktree creation, exact file write, PHP lint/test, exact-path commit, local-origin push, source-overlay verification, and rollback.
- [x] Verify Node syntax and helper suite 4/4 PASS.

### Task 3: Level-3 registration installer

**Files:**
- Create: `bootstrap-host-actions-v17-honartik-iticket-pretoken-prepare-v1.js`
- Test: `test-v17-honartik-iticket-pretoken-prepare-registration-v1.js`

- [x] Write RED registration test before installer exists.
- [x] Bind installer to current Base/Executor/MCP/Policy SHAs.
- [x] Add fixed Base/Executor/MCP/Policy registration and Level-3/high typed scope.
- [x] Embed exact helper SHA and sandbox helper execution to AF_UNIX with narrow writable paths.
- [x] Add backup, atomic installation, service health verification, and rollback.
- [x] Verify Node syntax and registration suite 4/4 PASS.

### Task 4: Git and runtime

- [ ] Commit helper, tests, installer, spec, and plan on `feature/honartik-iticket-pretoken-v1` in `prhmonline/prhm-host-actions`.
- [ ] Open a PR and verify committed SHA.
- [ ] Stage/install the exact V17 installer on the Control Plane using the existing approved deployment mechanism.
- [ ] Verify the new Host Action is exposed and policy-classified Level-3/high.
- [ ] Execute the action with fresh Level-3 approval.
- [ ] Verify isolated Honartik worktree/branch/commit/origin SHA and unchanged production overlay.

### Task 5: Stop one step before token

- [ ] Verify the prepared provider remains disabled with no token.
- [ ] Record exact ignored configuration keys for later token insertion: `enabled`, `base_url`, `token`, `auth_header`, `auth_prefix`.
- [ ] Do not perform authenticated iTicket smoke test or production activation until the token is inserted later.
