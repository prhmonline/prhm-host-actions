# Moeinshow SEO Host Action v1

## Goal
Fix the confirmed Moeinshow SSR/API routing failure, add robots/sitemap, and remove the temporary Agent repair route through the existing fixed Level-4 Host Actions v2 architecture.

## Root cause
Next.js SSR calls `dashboard.moeinshow.com` through the public edge from the production host, causing `ECONNREFUSED`. Article 9/10/11 then render null data and return 500. `robots.txt` and `sitemap.xml` return 404.

## Chosen design
Add a no-input fixed action `moeinshow_seo_repair_v1` with operation `host_action.moeinshow_seo_repair_v1`. Use a site-specific bootstrap `bootstrap-moeinshow-seo-repair-v1.js`; do not claim global v5/v6 because draft PR #2 already owns v5 for LeadOps Economics.

The bootstrap is SHA-bound and follows the canonical Host Action v4 pattern. It modifies exactly these control-plane layers: approval policy, base self-maintenance Host Action v2 allowlist, self-maintenance executor/helper dispatch, MCP Host Action v2 enum/description, and the temporary Agent API compatibility shim. Every changed file is backed up before install and restored on any install or health-check failure. Existing Host Actions must remain visible and behaviorally unchanged.

The temporary `/moeinshow/seo-repair` route and its SSH helper are removed from `fileBasicRoutes.js`, while `moeinshow_front_prod` registration and the existing LeadOps compatibility patch are preserved.

The fixed helper accepts no inputs. It preflights the local dashboard TLS vhost, adds exact `127.0.0.1 dashboard.moeinshow.com` only when no conflicting mapping exists, creates canonical `robots.txt` and `sitemap.xml` atomically, excludes `/home`, verifies root/articles 9-11/theaters 1 and 3/robots/sitemap locally, and restores `/etc/hosts` plus prior SEO files on failure.

`--preflight-only` performs zero mutation and validates live SHA preconditions, unique patch anchors, JSON, JavaScript syntax, preservation of existing actions, removal of the temporary route in the candidate, candidate action visibility, and candidate hashes.

After installation, create a fresh Level-4 request and require a fresh `CONFIRM_LEVEL_4_CRITICAL`. Execute only through `host_action_v2_apply`. Then verify fresh public 200 responses for root, article 9/10/11, theater 1/3, robots and sitemap; confirm `/home` is absent from the sitemap; and confirm bounded fresh logs contain no new dashboard `ECONNREFUSED` or article null-title crash. Only then is Search Console validation ready.

## Rejected approaches
Direct production writes, temporary DeployHQ SSH commands, startup side effects, arbitrary shell tools, and reuse of expired confirmations are rejected because they bypass or weaken the fixed-action approval model.

## Success criteria
Repository change reviewed; server-side preflight passes; bootstrap installs with rollback protection; base/executor/MCP health expose the fixed action; temporary Agent route is gone; fresh Level-4 execution succeeds; all target public checks and bounded logs pass; then Search Console validation may proceed.
