# iMotion Admin dynamic-write admission gate (candidate only)

**Scope:** admin.i-motion.ir, Nginx 1.27 in imotion-nginx.
**Status:** proposed source and tests; **not installed or active in Production**.

This is a bounded maintenance gate for the eventual Git-first cutover of Imo-back
commit 05112307acd9bf3d754a2f25d47a1be6be64e1ad, replacing Production code
currently at 663627e38880db68c9fbe9488681773fbf605e2c with 27 pre-existing
local changes. Neither this code nor its CI performs a cutover.

## Why block dynamic GET as well?

Legacy Yii endpoints may perform changes on a GET. Stopping only POST/PUT/PATCH/
DELETE is not a reliable write barrier. While the control flag is present, this
gate responds 503 to the admin site's dynamic location / and location ~ \.php$
before PHP routing and OPTIONS handling. Static asset location, static-file
regex routes, loopback-only Nginx status and PHP-FPM status remain governed by
the previous config. The gate is intentionally conservative: ordinary dynamic
GETs are unavailable too during a short approved cutover.

## Git-first build steps (safe / isolated)

A reviewed, authorized operator runs the renderer using the exact expected
SHA-256 of the existing Nginx configuration, producing a new candidate file,
never replacing the active config:

    python3 ops/imotion/admin_writer_gate.py \
      --input ORIGINAL_NGINX_CONF \
      --output NEW_CANDIDATE_CONF \
      --expected-sha256 EXACT_64_HEX_BASELINE_SHA

Baseline fingerprint observed in isolated preflight on 2026-10-12:
3cde5139f8eef7f821b8b34eb0353f17e55e7a38c2780d2e598a66deb54ad27a.

The renderer rejects source drift, unexpected routing layout, double-injection,
invalid flag paths, an existing output file and output in the managed config or
live production webroot. It modifies only two dynamic location blocks of
the SSL vhost admin.i-motion.ir. A future independent approval-bound deployment
action must verify the commit SHA of this renderer and the exact Nginx config
preimage, render a candidate, test nginx -t in a disconnected container, then
install/activate it under an explicit deployment approval. There is currently
no such authorized deployment action attached to this PR.

## Control state, security and reversibility

Default sentinel path is
/home/imotion/.deploy-gates/admin-i-motion-ir.cutover. The future controller
must create this directory outside the document root (root-owned, traversable
by Nginx) and create/remove only the sentinel atomically with a restrictive,
audited host-action workflow. A sentinel file alone does nothing until a
reviewed Nginx config is deployed.

The web server's /home/imotion mount is read-only; the PHP container has a
writeable /home/imotion mount. A security-reviewed control must ensure
untrusted application code cannot create, remove or replace the sentinel
(e.g. root-owned directory not writable by the imotion PHP user). Never
make this a public URL or store secrets in the sentinel.

When the flag is absent, routing is unchanged. When present, the dynamic
locations return 503, including GET, POST and OPTIONS. Other iMotion domains
are unaffected. Restore the original, exact config on abort if required; never
silently overwrite Nginx config or assume a flag transition restarts workers.
The config needs installation and testing before the flag can protect writes.

HTTP admission is only one element. Quiesce all scheduled SMS, device,
WordPress and maintenance writers, coordinate imotion-frontend-watchdog.timer,
drain in-flight requests, take a new consistent MariaDB backup and finalize
Shared delta sync. This gate does not stop direct DB writes, background jobs,
WebSocket sessions or external device requests. Review all relevant ingress
routes (including proxy/canonical aliases) and bypasses before Production
approval. Keep monitoring on where safe.

## Preflight integration tests (no Production config changes)

With an unconnected nginx:1.27-alpine container (--network none, no published
ports), the generated candidate Nginx config passed nginx -t.
Actual HTTPS status tests with a sandbox-only flag path gave:

| Request | Flag absent | Flag present |
|---|---:|---:|
| GET /__gate_probe | 502* | 503 |
| POST /__gate_probe | 502* | 503 |
| OPTIONS /__gate_probe | 204 | 503 |
| GET /index.php | 502* | 503 |
| GET /assets/.empty | 200 | 200 |
| GET /nginx-status | 200 | 200 |

*502 expected: isolated test instance had no PHP upstream. Removing
the flag restored the pre-gate behavior without config reload. The sandbox
container was removed. This proves isolated HTTP behavior, not real live
application health or safe production deployment.

Local unit tests:

    python3 tests/test_imotion_admin_writer_gate.py -v

## Production acceptance gates — all required

- Reviewed Pull Request merged to a fixed Git commit; SHA-bound installation
  control approved by the owner; no ad hoc live config edits.
- Source Nginx config SHA and target vhost still match the expected snapshot;
  inspect proxy aliases and complete ingress routing.
- Root-only flag directory/sentinel permission tests succeed in the actual
  Nginx worker and PHP user namespaces; no publicly writable control surface.
- Block/no-block functional tests on staging or equally isolated dry-run,
  plus HTTP/static/health regression and origin/upstream verification.
- Confirm zero in-flight writers, pause relevant timers and watchdog by
  approved operation, obtain final DB backup and verified delta sync.
- Pre-stage known-good old Nginx config and prior dirty Production tree as
  recoverable versions. Test atomic code exchange and reversal with opcache
  refresh, restore exact timer state on abort. Monitor immediate catch-up.
- Audited logger records repo, SHA, destination, timestamp, test results,
  explicit approval and rollback when applicable.

Production remains NO-GO until these separate controls are complete.
