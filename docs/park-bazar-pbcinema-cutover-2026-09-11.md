# Park Bazar → PBCinema Production Cutover Closure

Date: 2026-09-11

## Status

Production cutover completed successfully.

Final public hostnames:

- `https://pbcinema.ir`
- `https://www.pbcinema.ir` → canonical redirect to apex
- `https://dashboard.pbcinema.ir`

Legacy Park Bazar hostnames intentionally remain active:

- `https://park.prhm.ir`
- `https://dashboard.park.prhm.ir`

No old-domain-to-new-domain redirect was introduced.

## Application Git closure

### Frontend

Repository:

`prhmonline/cfpark_new_front`

Production Git commit:

`98f3a2e0cf79c53f41959d16e977f988e6c610a9`

Runtime/canonical files:

- `src/middleware.ts`
- `src/constants/apiRoutes.ts`
- `next.config.mjs`

Runtime SHA-256:

- middleware: `e9d6e2d78599ee38bb8bf377e8b544c50b2965e5bb6983ddbfffd57d625adabe`
- apiRoutes: `e233cd324d0c1664ce91153063e8988b23ab4e1ddd8ac76a7a828fa786b9c4bb`
- next.config: `51a66916ec68659bcf4fb66ef61566866fec111b19b5eb4406008394dd7d7fd8`

Canonical Next.js 14.2.5 production build completed successfully, including:

- compile
- lint/type validation
- page data collection
- static generation 19/19
- build trace collection
- page optimization

### Admin/backend

Repository:

`prhmonline/cfpark-back-new`

Production Git commit:

`ebc4331be26fa78b996bbe81c5df31eada310101`

The preceding local commit was preserved:

`852fc01538e756e7df90249675b0952b2b7c65d2`

PBCinema files:

- `app/modules/api/controllers/ReserveController.php`
- `app/modules/api/controllers/TransactionController.php`

Runtime SHA-256:

- ReserveController: `2e1b6e5f326a170da8fa20e548d5c47569c1518f3cd1023304504a70b7719e49`
- TransactionController: `5722c86ad723ca651190261cdfe5419c14cc32db827dc1072f04ab84756e3146`

PHP syntax validation passed for both files.

## Origin / Apache state

Production origin:

`10.71.0.118`

PBCinema Apache configuration:

`/etc/httpd/conf.d/pbcinema-vhosts.conf`

SHA-256:

`2b0e554a7c685731ccc1987f1ec37b9b27f0752f875aec6ae521102774915e92`

Origin deployment backup:

`/var/backups/pbcinema-origin-v8/20260911-165207`

Origin validation result:

`PBCINEMA_ORIGIN_V8=PASS`

## Public edge / Nginx state

Public edge:

`185.191.76.138`

Active Nginx configuration:

`/etc/nginx/nginx.phase7b.conf`

SHA-256:

`a17a19a7a96b403ebba8ce6adf7ada6eaf3ca62e53f0dee0bc02303a1a700727`

Certificate deployment helper:

`/usr/local/sbin/prhm-edge-cert-deploy`

SHA-256:

`0fcc75579b799b2883a110adf9cee9fb09a9b4a0bd50d664169f76e06d5ba4ae`

Edge deployment backup:

`/var/backups/pbcinema-edge/20260911-170726`

Edge validation result:

`PBCINEMA_EDGE_CUTOVER=PASS`

## TLS state

Let's Encrypt lineage:

`pbcinema.ir-edge`

Certificate names:

- `pbcinema.ir`
- `www.pbcinema.ir`
- `dashboard.pbcinema.ir`

Certificate deployment paths:

- `/etc/nginx/certs/pbcinema/pbcinema.ir.cert.combined`
- `/etc/nginx/certs/pbcinema/pbcinema.ir.key`

Public combined certificate SHA-256:

`b01cde0f7c67f96227e08fbae418fb19f5aeda04fe642245a120e6ed7d0cc4b7`

Certificate expiry:

`2026-12-10`

Renewal mapping:

`copy_pair pbcinema.ir-edge pbcinema/pbcinema.ir.cert.combined pbcinema/pbcinema.ir.key`

Certbot renewal dry-run:

`PASS`

Private key material is intentionally not stored in Git.

## Final public regression

Observed final status:

- `https://pbcinema.ir/home` → HTTP 200
- `https://www.pbcinema.ir/` → HTTP 301
- `https://dashboard.pbcinema.ir/` → HTTP 302
- `https://dashboard.pbcinema.ir/api/` → HTTP 200
- `https://park.prhm.ir/` → HTTP 307
- `https://dashboard.park.prhm.ir/` → HTTP 302

Result:

`PUBLIC_REGRESSION=PASS`

## Closure guarantees

- frontend production runtime is represented in canonical Git
- backend production runtime is represented in canonical Git
- frontend and backend were pushed non-force
- unrelated historical backup files were not committed
- existing backend local history was preserved
- legacy Park Bazar domains remain active
- PBCinema TLS renewal is configured
- no private key or secret material is stored in this repository
- no production mutation is performed by this closure artifact
