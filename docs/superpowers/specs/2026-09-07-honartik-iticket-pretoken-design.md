# Honartik iTicket Pre-Token Preparation V1 Design

**Status:** Approved by user instruction to complete all work before entering the real token.

## Goal

Prepare Honartik for iTicket activation without reading, storing, transmitting, or testing the real iTicket token and without changing the live Honartik application tree or database.

## Current baseline

- Production backend root: `/home/honartik/domains/dashboard.honartik.ir/public_html`
- Production branch: `main`
- Production HEAD: `1eb4335da14f9eacf23b9d5fd4288c133786386c`
- Existing provider: `app/components/external/base.php`
- Existing provider SHA-256: `ca14ecdc210c418686c73d5ef60b150adc0629d6b943b32d11d0d06dd3a3bdf6`
- Existing unrelated dirty production overlay in `app/modules/api/models/Event.php` is explicitly preserved and excluded from iTicket work.

## Architecture

Use the existing `app\components\external\base` provider interface so current Honartik reservation, payment, seat locking, settlement, cancellation, and ticket flows remain authoritative. Replace only the provider implementation in an isolated linked worktree and add a standalone contract test.

The provider keeps the existing methods `places`, `events`, `schedules`, `seats`, `status`, `fail`, `reserve`, `sale`, and `cancel`. It moves authentication to secret-backed configuration and defaults to disabled. `base_url`, `auth_header`, and `auth_prefix` are configurable so the same code can support the current `seller.iticket.ir` Bearer profile or a partner `X-Api-Access-Token` profile without source changes.

## Secret boundary

No real token appears in Git, Host Action arguments, result JSON, logs, exceptions, debug output, or tests. Later activation sets the token only in ignored production configuration (`/_env/` or environment) and flips `enabled=true` after an authenticated smoke test is explicitly ready.

## Host Action

Fixed no-input action: `honartik_iticket_pretoken_prepare_v1`.

The action creates `/home/honartik/worktrees/iticket-pretoken-v1-back` on branch `feature/iticket-pretoken-v1` from the exact production HEAD. It changes only:

- `app/components/external/base.php`
- `app/components/external/tests/IticketExternalProviderTest.php`

It runs PHP lint and the standalone contract test, commits exactly those paths, pushes the branch to the existing local bare `origin`, and verifies the remote branch SHA. The live production application tree and its existing dirty overlay must be byte/state-equivalent before and after.

## Safety boundaries

The executor runs the helper in a systemd sandbox with `RestrictAddressFamilies=AF_UNIX`, read-only home/system protection, and narrowly scoped writable Git/worktree/result paths. The Host Action itself has no HTTP client, no iTicket token read, no DB access, and no production application write.

The action is Level-3/high under the current policy model because it changes only isolated worktree/Git metadata and never deploys or contacts iTicket. A separate activation/deploy step remains outside this action.

## Verification

Success requires:

- exact production HEAD/provider SHA and exact local origin identity;
- no pre-existing target worktree/branch;
- PHP lint PASS for both files;
- `ITICKET_EXTERNAL_PROVIDER_TEST=PASS`;
- exact two-path diff and exact two-path commit;
- pushed origin branch SHA equals local commit SHA;
- isolated worktree clean after commit;
- production HEAD and production overlay unchanged;
- result flags: production application mutation false, DB false, deploy false, external network false, token read false.
