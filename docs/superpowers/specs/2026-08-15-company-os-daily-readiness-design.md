# Company OS Daily Readiness v8 — Design

## Goal
Make Company OS usable as a daily operating console while preserving the current fail-closed safety model. The release has two independently testable outcomes: a positive real-market historical replay UAT with provenance-backed economics, and a separate graphical read-only Company OS dashboard.

## Safety boundaries
- `P0_SHADOW_MODE=true` remains the only enabled P0 flag.
- `P0_DECISION_ENABLED=false` remains false.
- Proposal send, Bid send, outbox write, Telegram write and P0 Live remain disabled.
- Dashboard exposes no mutation endpoint and cannot execute approvals, sends or host actions.
- Positive UAT may create only opportunity-scoped temporary Economic Facts and one temporary UAT decision; all are removed in `finally` and residue is independently verified.
- Every production mutation is installed or run through a fresh Level-4 Host Action request with one-time approval consumption.

## Positive UAT target and provenance
Target opportunity is fixed server-side to Karlancer external id `310319`, opportunity id `a3294311-871b-498a-8ffb-484bd51f2b92`, service `GENERAL_TRANSLATION`, 300 words, Persian to English, listed budget 800,000–1,500,000 Toman.

The UAT facts are fixed and carry provenance objects. They are derived only from current business/platform evidence:
- `recommendedPrice=800000`: conservative use of the listing's minimum budget, never above the client range.
- `platformMinimum=800000`: listing minimum budget.
- `deliveryCost=30900`: 300 words × 103 Toman/word. The 103 Toman current internal delivery rate is corroborated by multiple recent completed DrTarjomeh Persian→English orders whose `price_translator/count_admin` equals 103.
- `platformFee=120000`: conservative 15% fee ceiling on the 800,000 Toman replay bid; this is a controlled UAT policy bound, not a claim about the live account fee.
- `aiOpsCost=0`: this isolated UAT performs no external paid model/provider call.
- `paymentFee=0`: no additional payment fee is modeled separately for this isolated platform UAT; uncertainty is covered by reserve.
- `riskReserve=80000`: conservative 10% UAT reserve policy.
- `hardFloor=230900`: fixed replay cost envelope = 30,900 delivery + 120,000 fee ceiling + 80,000 reserve + zero separately modeled AI/payment fees.
- `minimumMarginPrice=288625`: hardFloor / 0.80, the minimum price that preserves a 20% margin under the fixed replay cost envelope.

`winProbability` and `humanHours` are optional and intentionally omitted until a verified historical estimator exists.

Replay clock is pinned only inside the disposable worker copy to one hour after the original discovery timestamp; production freshness logic is unchanged. Expected engine result: `SEND_NOW`, `autoSendAllowed=false`, final bid 800,000 Toman, positive margin above 20%. The test validates provenance, no-send invariants, and full cleanup.

## Dashboard architecture
A dedicated package is installed at `/opt/prhm-company-dashboard` with two units:

1. `prhm-company-dashboard-collector.service` + timer: root-owned oneshot, read-only with respect to business systems. It reads LeadOps through the existing read-only shadow DB role, summarizes Host Action job JSON, reads service health/feature flags, sanitizes fields, and atomically writes `/var/lib/prhm-company-dashboard/snapshot.json`.
2. `prhm-company-dashboard.service`: unprivileged Node HTTP server bound to `127.0.0.1:18136`. It serves only static assets and GET APIs from the sanitized snapshot. It cannot access LeadOps credentials or Host Action job directories.

Public path is `https://agent.prhm.ir/company-os/`, reusing the existing agent.prhm.ir TLS edge. The VM Apache route proxies only requests whose Host is `agent.prhm.ir` and path starts `/company-os/` to the loopback dashboard service.

Authentication is HTTP Basic at the dashboard service. Installer generates a strong random password once, stores only salted SHA-256 verification material in `/etc/prhm-company-dashboard/auth.json`, and writes the bootstrap credential once to `/root/company-os-dashboard-credentials.txt` mode 0600 for the owner to retrieve. No credential is embedded in Git, HTML or logs.

## UI/UX direction
Product: executive operations dashboard. Personality: precise, calm, premium. Language: Persian RTL. Density: compact but not cramped.

Dashboard sections:
1. `امروز`: headline health, last snapshot time, blockers, pending opportunities and safety state.
2. `فرصت‌ها`: latest opportunities with source, service, score, budget, decision and economics completeness.
3. `اقتصاد و تصمیم`: verified-fact coverage, latest shadow decisions, price/margin when complete, explicit incomplete badges when not.
4. `تأییدها`: recent Host Actions with Level, status, action, request id and approval-consumed state.
5. `سلامت سیستم`: Agent API, self-maint executor, Shadow Worker/DB availability, feature flags.
6. `گزارش‌ها`: latest UAT/self-test summaries and request/run ids.

Design tokens: neutral dark ink text, off-white surface, restrained blue primary, green success, amber warning, red danger; 14–16px base type, 12/16/24/32 spacing scale, 12–16px radii, subtle single-level shadows. System theme is respected. Tables collapse to stacked cards on small screens. Auto-refresh every 60 seconds with visible freshness timestamp and manual refresh button.

## Error handling
- Collector failure never changes the last good snapshot; it writes an error marker separately and systemd reports failure.
- Dashboard shows stale-data banner when snapshot age >180 seconds.
- Missing DB/report source becomes `unavailable`, never fabricated zero.
- Failed authentication returns 401 with `WWW-Authenticate`; five failures per IP per five minutes are rate-limited in-memory.
- Apache/config/service install is SHA-bound with backup, syntax validation, health check and automatic rollback.

## Verification gates
- Unit/static tests are written first and observed RED.
- Positive UAT helper tests include expected fixed target, provenance, economic calculations, no-send and cleanup.
- Dashboard tests verify no POST/PUT/PATCH/DELETE business API, auth enforcement, sanitization, stale-state rendering and RTL/mobile markup.
- Install preflight must report zero production/business mutation.
- Post-install local health and authenticated snapshot API must pass.
- Public `agent.prhm.ir/company-os/` must return 401 unauthenticated and 200 with generated credentials.
- Final independent DB audit proves UAT fact residue=0, UAT decision residue=0 and send counters unchanged.
