# Existing Root Scripts Stage Mediator MCP Facade V1 — Implementation Plan

**Goal:** Expose the already-installed fixed root-scripts mediator through three narrow MCP tools without adding a new Agent API bridge.

## Task 1 — TDD contract
- Write the focused test before the candidate exists and observe `ERR_MODULE_NOT_FOUND`.
- Implement only the fixed mediator socket, three tool schemas, bounded AF_UNIX client, input validation, and MCP registration.
- Verify zero-input preflight/request, UUID+literal-only apply, and absence of arbitrary action/path/command/payload/SHA/repository/URL/service/SQL/token/credential inputs.
- Run Node syntax checks and focused tests.

## Task 2 — Persist evidence
- Commit amendment spec, plan, candidate, and test on the existing isolated implementation branch.
- Re-read committed bytes by commit SHA.
- Re-run syntax and focused tests from committed bytes and record exact byte counts and SHA-256 values.

## Task 3 — Separate live install gate
- Freshly re-read `/home/agent/ssh-mcp-server/src/plugins/selfmaint.js` and its SHA-256.
- Render an exact replacement that imports/registers the fixed facade without changing other tools.
- Create only a SHA-bound `selfmaint_request` for `agent_mcp/src/plugins/selfmaint.js`.
- Do not apply until a fresh independent `CONFIRM_LEVEL_4_CRITICAL` is provided.
- After apply, verify MCP health and the three new tools, then use mediator preflight/request flow.
