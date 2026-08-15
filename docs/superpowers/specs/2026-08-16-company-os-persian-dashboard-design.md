# Company OS Persian Dashboard Design

**Date:** 2026-08-16  
**Status:** Approved design, implementation not started

## Goal

Make the existing read-only Company OS dashboard suitable for Mohammad's daily use by presenting all operational decisions in Persian, linking each opportunity to its original marketplace page, showing exactly what was actually sent to the customer (distinct from unsent drafts), and exposing marketplace-source coverage and freshness.

## Scope

This change is limited to the Company OS dashboard presentation/snapshot layer. The P0 decision engine, LeadOps decision codes, database source-of-truth values, approval semantics, send gates, and live-send flags must remain unchanged.

## Non-negotiable safety constraints

1. Dashboard remains read-only.
2. Internal decision/reason/service/status codes remain unchanged in the engine and database.
3. Persian labels are a presentation-layer mapping only.
4. No new external send path is introduced.
5. `P0_LIVE`, proposal auto-send, bid auto-send and related live-send flags must remain disabled unless separately approved in a future gate.
6. A record must never be labelled «ارسال‌شده» unless evidence proves the payload was actually sent.
7. Missing source data must be shown explicitly; the UI must not invent links, timestamps, messages or delivery state.

## 1. Persian localization

All user-facing dashboard labels must be Persian, including decision, reason, status, evaluation, service category, source label and operational badges.

### Decision mappings

| Internal code | Persian label |
|---|---|
| `SEND_NOW` | مناسب برای ارسال پیشنهاد |
| `ASK_CLARIFICATION` | نیاز به اطلاعات بیشتر |
| `PRICE_UP` | نیاز به افزایش قیمت |
| `ESCALATE_TO_CEO` | نیاز به تصمیم مدیر |
| `REJECT_FALSE_POSITIVE` | رد — پروژه نامرتبط |
| `REJECT_UNPROFITABLE` | رد — از نظر اقتصادی مناسب نیست |
| `CHANNEL_BLOCKED` | امکان ارسال از این کانال وجود ندارد |
| `STALE` | پروژه قدیمی یا منقضی شده |

### Reason mappings

| Internal code | Persian label |
|---|---|
| `false_positive` | پروژه با خدمات ما مرتبط نیست |
| `freshness_unknown` | زمان انتشار پروژه مشخص نیست |
| `opportunity_stale` | زمان مناسب اقدام گذشته است |
| `platform_quota_exhausted` | سهمیه ارسال در پلتفرم تمام شده است |
| `price_inputs_missing` | اطلاعات قیمت کافی نیست |
| `economics_inputs_incomplete` | اطلاعات مالی برای تصمیم‌گیری کامل نیست |
| `profitable` | سودآوری مناسب است |
| `margin_below_15_percent` | حاشیه سود کمتر از ۱۵٪ است |
| `margin_between_15_and_20_percent` | حاشیه سود بین ۱۵٪ تا ۲۰٪ است؛ نیاز به تصمیم مدیر |
| `economic_floor_above_client_budget` | حداقل قیمت اقتصادی بیشتر از بودجه مشتری است |

Unknown codes must render as `نامشخص` plus the original internal code in a secondary technical field, rather than leaking raw English as the primary label.

## 2. Project source link

Every opportunity detail must include `original_url` when the source system has a trustworthy URL.

UI behavior:

- Opportunity title is clickable when `original_url` is present.
- A visible button labelled `مشاهده آگهی اصلی` opens the same URL in a new tab.
- If a historical record has no stored URL, show `لینک آگهی ثبت نشده است`.
- Never reconstruct or guess a URL from only an external ID.
- The snapshot collector may normalize an already-stored source URL but must not fabricate one.

## 3. Exact outbound communication history

Opportunity details gain a section called `ارتباطات و پیشنهادها`.

Each communication record must expose, when available:

- `channel`
- `created_at`
- `sent_at`
- `delivery_status`
- `external_message_id` or equivalent provider/platform ID
- `payload_text` — exact final text, without summarization or rewriting
- `kind` — proposal, bid, message, clarification, or other known type

### Display states

**Actually sent**  
Shown only when persisted send evidence exists. Label: `ارسال‌شده به مشتری`. Display exact payload and send timestamp.

**Prepared but not sent**  
If a proposal/message was generated but send evidence is absent and the system remained in shadow/no-send mode. Label: `پیش‌نویس آماده‌شده — ارسال نشده`. Display exact draft text if stored.

**No communication**  
If neither a sent payload nor a draft exists. Label: `هیچ پیامی برای این پروژه ارسال نشده است`.

The dashboard must not infer actual sending from a decision such as `SEND_NOW`.

## 4. Source coverage panel

The dashboard adds a `منابع بررسی پروژه` panel. Each configured source shows:

- Persian source name
- operational state: `فعال`, `غیرفعال`, `متصل نیست`, or `وضعیت نامشخص`
- `last_checked_at`
- number of opportunities discovered in the current day when available
- optional last error summary when a collector/monitor reports failure

Initial sources in scope:

- ParsCoders / پارس‌کدرز
- Karlancer / کارلنسر
- Divar / دیوار

The panel must derive status from real collector/workflow/service evidence. Presence of old workflow files alone is not sufficient to mark a source `فعال`.

## 5. Current source interpretation at design time

- ParsCoders: proven integrated through prior real-market LeadOps UAT.
- Karlancer: marketplace-specific workflows exist for bidding, quota refresh, bid-status monitoring and message monitoring. Collector runtime activity must be verified before UI marks it active.
- Divar: no active LeadOps integration has been proven; default UI state is `متصل نیست` until an explicit integration is implemented and verified.

## 6. Snapshot/API contract

Extend the existing read-only snapshot with additive fields only. Existing consumers must remain compatible.

Recommended opportunity shape additions:

```json
{
  "original_url": "https://…",
  "display": {
    "decision_fa": "…",
    "reason_fa": "…",
    "status_fa": "…",
    "service_fa": "…",
    "source_fa": "…"
  },
  "communications": [
    {
      "kind": "proposal",
      "channel": "karlancer",
      "delivery_state": "sent|draft|none|unknown",
      "payload_text": "exact persisted text",
      "created_at": "ISO-8601",
      "sent_at": "ISO-8601|null",
      "external_message_id": "string|null"
    }
  ]
}
```

Recommended source-health shape:

```json
{
  "sources": [
    {
      "code": "parscoders",
      "name_fa": "پارس‌کدرز",
      "state": "active|inactive|not_connected|unknown",
      "state_fa": "فعال",
      "last_checked_at": "ISO-8601|null",
      "discovered_today": 0,
      "last_error": null
    }
  ]
}
```

## 7. UI structure

Opportunity list remains compact. Each row/card shows:

- project title
- source
- Persian decision badge
- Persian reason
- budget/value when available
- direct original-project link
- last relevant timestamp

Expanded details show:

1. Project metadata
2. Decision and Persian explanation
3. Economics details
4. `ارتباطات و پیشنهادها`
5. Technical trace collapsed by default, containing raw internal codes/IDs for audit/debugging

Source coverage appears near the top of the dashboard as a compact operational panel.

## 8. Error handling

- Missing localization mapping: show Persian `نامشخص` and preserve raw code only in technical trace.
- Missing URL: show explicit missing-link text, no guessed URL.
- Missing communication evidence: never claim sent.
- Snapshot collector failure: retain last known snapshot but mark source freshness/error visibly.
- Invalid external URL: do not render it as a clickable link.

## 9. Testing requirements

Implementation must be TDD and cover at minimum:

1. Every current decision code maps to Persian.
2. Every current reason code maps to Persian, including `economics_inputs_incomplete` used by the worker override.
3. Unknown codes fail safely to `نامشخص`.
4. Real source URL renders; missing URL is not fabricated.
5. Sent message appears only with send evidence.
6. Draft text is explicitly marked unsent.
7. `SEND_NOW` alone never causes a `sent` label.
8. Source panel does not mark Karlancer or Divar active merely because workflow files exist.
9. Dashboard remains read-only; no POST/PUT/PATCH/DELETE application route is added.
10. Existing authentication, loopback bind, Apache proxying and collector timer remain healthy after deployment.

## 10. Acceptance criteria

The work is complete when Mohammad can open one opportunity and answer, without reading any English operational code:

- این پروژه از کدام سایت آمده؟
- لینک اصلی پروژه چیست؟
- سیستم چه تصمیمی گرفته و چرا؟
- آیا واقعاً چیزی برای مشتری ارسال شده یا فقط پیش‌نویس بوده؟
- اگر ارسال شده، متن دقیق چه بوده و چه زمانی ارسال شده؟
- الان پارس‌کدرز، کارلنسر و دیوار کدام‌یک واقعاً در حال بررسی هستند و آخرین بررسی چه زمانی بوده؟

All of this must be available without enabling any live-send capability.