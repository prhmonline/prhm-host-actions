# Moeinshow SEO Host Action v1

## Goal
Fix the confirmed Moeinshow SSR/API routing failure, add robots/sitemap, and remove the temporary Agent repair route through the existing fixed Level-4 Host Actions v2 architecture.

## Root cause
Next.js SSR calls dashboard.moeinshow.com through the public edge from the production host, causing ECONNREFUSED. Article 9/10/11 then render null data and return 500. robots.txt and sitemap.xml return 404.

## Chosen design
Add a no-input fixed action `moeinshow_seo_repair_v1` with operation `host_action.moeinshow_seo_repair_v1`. Use a site-specific bootstrap `bootstrap-moeinshow-seo-repair-v1.js`; do not claim global v5/v6 because draft PR #2 already owns v5 for LeadOps Economics.

The bootstrap is SHA-bound, uses unique anchors, backs up every changed control-plane file, preserves existing Host Actions, removes only the temporary `/moeinshow/seo-repair` capability while retaining `moeinshow_front_prod`, and rolls back on any install/health failure.

The fixed helper accepts no inputs. It preflights the local dashboard TLS vhost, adds exact `127.0.0.1 dashboard.moeinshow.com` only when no conflicting mapping exists, creates canonical robots.txt and sitemap.xml atomically, excludes `/home`, verifies root/articles/theaters/robots/sitemap locally, and restores hosts/SEO files on failure.

`--preflight-only` performs zero mutation and validates SHAs, anchors, JSON, JavaScript syntax, candidate action visibility, preservation of existing actions, temporary-route removal in the candidate, and candidate hashes.

After install, create a fresh Level-4 request, require fresh `CONFIRM_LEVEL_4_CRITICAL`, execute only through `host_action_v2_apply`, then verify public 200 responses for root, article 9/10/11, theater 1/3, robots and sitemap, plus absence of new ECONNREFUSED/null-title errors in bounded fresh logs. Only then is Search Console validation ready.

## Rejected approaches
Direct production writes and temporary DeployHQ SSH commands are rejected because they bypass or weaken the canonical fixed-action model and have already been blocked by the platform safety layer.

## Success criteria
Repository change reviewed; server-side preflight passes; bootstrap installs with rollback protection; temporary Agent route is gone; fixed action is visible; fresh Level-4 execution succeeds; all target public checks and logs pass; then Search Console validation may proceed.
