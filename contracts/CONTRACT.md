# Foresight contract (agree this, then don't break it)

Three services, one vocabulary:

```
Lovable UI ──► n8n webhooks (chat, voice, email, Telegram)  ──► Engine API
     └──────────────────────────────► Engine API (charts, fast what-ifs)
```

The UI calls the **engine directly** for charts and button-driven what-ifs (fast, no LLM),
and calls **n8n** for anything AI, voice or external (chat, TTS, invoice emails, alerts).

---

## Engine API (Person 1) - `ENGINE_URL`

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | | `{ok: true}` |
| GET | `/profiles` | | `{as_of, profiles: ProfileSummary[]}` |
| GET | `/profiles/{id}/summary` | | `Summary` |
| POST | `/forecast` | `{profile_id, days?=90, adjustments?=[]}` | `Forecast` |
| POST | `/simulate` | `{profile_id, days?=90, adjustments}` | `{baseline, focus_alert, scenario: Forecast, delta}` |

Real example payloads: `frontend/src/mocks/*.json` (generated from the engine, not hand-written).

### Forecast (key fields)
```jsonc
{
  "profile_id": "corner_cup", "mode": "business", "as_of": "2026-11-07", "balance_now": 4773.91,
  "hero": { "label": "Cash runway", "value": 7.6, "unit": "weeks", "note": "...", "kpis": [ {label, value, unit} ] },
  "history": [ { "date": "2026-09-09", "balance": 9120.4 } ],                     // last 60 days, actual
  "bands":   [ { "date": "2026-11-08", "p10": 3900, "p50": 4700, "p90": 5600, "p_negative": 0.01 } ],  // next N days
  "alerts":  [ {
      "id": "alert-2026-12-08", "title": "HMRC VAT before money comes in", "peak_date": "2026-12-08",
      "start": "...", "end": "...", "p_negative": 0.33, "explanation": "...", "causes": [ ... ],
      "actions": [ { "label": "Ask to move HMRC VAT 14 days later", "new_p_negative": 0.002,
                     "adjustment": { "type": "shift_stream", "stream_id": "hmrc_vat_out", "days": 14 } } ]
  } ],
  "upcoming": [ { "date": "...", "label": "...", "amount": -540, "stream_id": "..." } ],
  "risk_summary": { "peak_p_negative": 0.33, "low_point_p50": -7351, "low_point_date": "2027-01-01" }
}
```

### Adjustments (shared by UI buttons, the LLM planner, and n8n)
```jsonc
{ "type": "cut_spend", "weekly": 20 }
{ "type": "shift_stream", "stream_id": "rent_out", "days": 5 }      // stream ids come from /summary.recurring
{ "type": "remove_stream", "stream_id": "netflix_com_out" }
{ "type": "scale_stream", "stream_id": "deliveroo_payout_in", "factor": 0.75 }
{ "type": "income_change", "factor": 0.8 }                          // "what if I lose 20% of my income"
{ "type": "one_off", "amount": -300, "in_days": 10, "label": "Boiler repair" }
{ "type": "invoice_on_time" }                                       // business: chase overdue invoices
{ "type": "invoice_finance", "advance": 0.8 }                       // business: advance on unpaid invoices
{ "type": "client_late", "extra_days": 30 }                         // business: clients pay later
```

---

## n8n webhooks (Person 3) - `N8N_URL`

### `POST /webhook/accountant-chat`
```jsonc
// request
{ "profile_id": "amara", "mode": "personal", "message": "what if I lose my Saturday shift?",
  "history": [ { "role": "user", "content": "..." }, { "role": "assistant", "content": "..." } ],
  "voice": true }
// response
{ "reply": "markdown, <=120 words", "speak": "spoken version", "intent": "whatif",
  "adjustments": [ ... ],            // what the planner applied - UI re-runs /forecast with these
  "blocks": [ Block ],               // what to draw under the message
  "audio_base64": "...", "audio_mime": "audio/mpeg" }
```

### Blocks (the AI-first part: the accountant answers with visuals)
| type | payload |
|---|---|
| `kpis` | `items: [{label, value, unit}]` |
| `forecast_chart` | `data: {history, bands, alerts}` |
| `scenario_delta` | `focus: {title, p_before, p_after, peak_date}` |
| `alert` | `alert: Alert` |
| `actions` | `actions: Action[]` (each has an `adjustment` the UI can apply) |
| `category_chart` | `data: [{category, amount}]` |
| `cashflow_chart` | `data: [{month, in, out}]` |
| `upcoming` | `items: Upcoming[]` |
| `invoices` | `items: Invoice[]` |

The LLM only picks **which** blocks to show; n8n fills them with engine numbers, so charts can't be hallucinated.

### `POST /webhook/chase-invoice`
`{profile_id, invoice_id, tone?: "friendly"|"firm"}` -> `{subject, body, invoice}`

### `POST /webhook/send-email`
`{to, subject, body}` -> `{ok: true}`

### Scheduled: `Daily foresight alerts`
Runs 08:00 (and on a manual trigger for the demo). Sends each profile's top alert as an ElevenLabs voice note to Telegram.
