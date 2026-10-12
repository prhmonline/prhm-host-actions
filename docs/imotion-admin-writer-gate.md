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
live production webroot. A non-default flag path requires a separate explicit
test-only switch. It modifies only two dynamic location blocks of the SSL vhost
admin.i-motion.ir. A future independent approval-bound deployment action must
verify the commit SHA, Nginx config preimage, and Compose preimage; render and
test candidates before any approved installation. No approved deployment action
is attached to this PR.

## Root-only control mount; no PHP access

Default sentinel path **inside the Nginx container** is:

    /run/prhm-imotion-writer-gate/admin-i-motion-ir.cutover

This MUST be a read-only bind mount from a root-owned host path, NOT from
/home/imotion (owned by imotion, therefore replaceable by the PHP user).

Proposed additional, **NOT installed** Compose override:

    ops/imotion/compose.writer-gate.override.yml

It adds a bind from host source:

    /opt/imotion-stack/control/imotion-admin-writer-gate

to the container destination:

    /run/prhm-imotion-writer-gate

with read_only: true and create_host_path: false. The future Git-reviewed
controller must provision the source directory root:root 0755, with all parents
root-owned and inaccessible for writes by imotion, and must prove the PHP
container CANNOT mount/write it while Nginx UID 101 CAN stat a root-owned
0644 flag. PHP currently has /home/imotion rw; Nginx has /home/imotion ro.
No secrets, token, or user data are stored in the flag. Host-only root action
creates/removes the flag atomically; the override remains a distinct deployment
change requiring authorization, container recreate and health validation.

When the flag is absent, routing is unchanged. When present, the dynamic
locations return 503, including GET, POST and OPTIONS. Other iMotion domains
are unaffected. Retain exact old Nginx and Compose configs and reversion method
for rollback. A sentinel file has NO effect until a reviewed Nginx config and
the private bind mount are active.

HTTP admission is only one element. Quiesce SMS, device, WordPress and
maintenance writers, coordinate imotion-frontend-watchdog.timer, drain
in-flight requests, take a new consistent MariaDB backup and finalize Shared
delta sync. This gate does not stop direct DB writes, background jobs,
WebSocket sessions or external device requests. Review all alternate ingress
routes and bypasses before Production approval; keep monitoring on where safe.

## Isolated HTTP integration and CI

The Nginx renderer, full real Nginx config and candidate override are tested
outside Production. Run Python unit tests via:

    python3 tests/test_imotion_admin_writer_gate.py -v

Use a root-owned sandbox directory (e.g. under sticky /var/tmp) with 0755
permissions, mounted READ-ONLY in a network-isolated nginx:1.27-alpine test
container at /run/prhm-imotion-writer-gate. Do not mount the PHP-writable
/home/imotion tree as the flag source. Never publish test container ports.

The earlier isolated functional test used a sandbox-only flag path and passed
nginx -t; HTTP statuses were:

| Request | Flag absent | Flag present |
|---|---:|---:|
| GET /__gate_probe | 502* | 503 |
| POST /__gate_probe | 502* | 503 |
| OPTIONS /__gate_probe | 204 | 503 |
| GET /index.php | 502* | 503 |
| GET /assets/.empty | 200 | 200 |
| GET /nginx-status | 200 | 200 |

*502 expected: isolated test instance had no PHP upstream. Removing the
flag restored prior behavior without reload. The sandbox container was removed.
This proves isolated HTTP behavior, not Production readiness.

A second isolated test on 2026-10-12 validated the final root-only
mount design: a root:root 0755 host directory was mounted RO at
/run/prhm-imotion-writer-gate. The imotion user could not create
the flag; the actual PHP container could not see the flag path;
Nginx UID 101 could read, but not write, the bound flag. The real
full Nginx config passed nginx -t. GET/POST/OPTIONS/index.php
returned 503 with flag active, while static and status returned 200;
removing it restored baseline behavior. Disposable test container and
root-owned flag directory were both cleaned up. No production service
or configuration was changed.

## Production acceptance gates — all required

- Reviewed PR merged to an immutable commit; exact SHA-bound, single-use
  installation action approved by the owner. NO ad hoc live config edits.
- Nginx and Compose preimages match reviewed fingerprints; tests cover all
  alternate ingress and app-level background writers.
- Root-owned directory /opt/imotion-stack/control/… is NOT writable/replaceable
  from PHP; Nginx worker CAN stat the flag in its read-only mount.
- Nginx config syntax and HTTP block/no-block cases pass in isolated context;
  planned Compose merged output mounts only Nginx, not PHP.
- Quiesce and drain all writers, pause relevant timers/watchdog; take fresh
  consistent MariaDB backup; final Shared sync and hash/permission checks.
- Retain known-good Nginx config and old code including 27 dirty Production
  files; test atomic swap/reversal and PHP opcache refresh.
- Logged exact SHA, approval, pre/post health, destination, timestamp,
  unit states and rollback result.

**Production remains NO-GO until separate controls are complete.**
