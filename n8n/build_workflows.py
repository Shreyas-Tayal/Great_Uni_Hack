"""
Builds importable n8n workflow JSON files (n8n -> Workflows -> Import from File).

OWNER: Person 3. Edit the JS in here (or directly in n8n after import, then re-export).
After import: open the "Config" node in each workflow and paste your URLs/keys.
Do NOT commit real keys.
"""
import json
import uuid
from pathlib import Path

OUT = Path(__file__).parent

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


def node(name, ntype, version, params, pos, **extra):
    n = {"parameters": params, "id": str(uuid.uuid4()), "name": name, "type": ntype,
         "typeVersion": version, "position": pos}
    n.update(extra)
    return n


def code(name, js, pos):
    return node(name, "n8n-nodes-base.code", 2, {"jsCode": js.strip()}, pos)


def http(name, method, url, pos, body_expr=None, headers=None, file_response=False, on_error=None):
    p = {"method": method, "url": url, "options": {}}
    if headers:
        p["sendHeaders"] = True
        p["headerParameters"] = {"parameters": [{"name": k, "value": v} for k, v in headers.items()]}
    if body_expr:
        p["sendBody"] = True
        p["specifyBody"] = "json"
        p["jsonBody"] = body_expr
    if file_response:
        p["options"] = {"response": {"response": {"responseFormat": "file"}}}
    extra = {"retryOnFail": True, "maxTries": 3, "waitBetweenTries": 1000}
    if on_error:
        extra["onError"] = on_error
    return node(name, "n8n-nodes-base.httpRequest", 4.2, p, pos, **extra)


def webhook(path, pos):
    return node("Webhook", "n8n-nodes-base.webhook", 2,
                {"httpMethod": "POST", "path": path, "responseMode": "responseNode",
                 "options": {"allowedOrigins": "*"}}, pos, webhookId=str(uuid.uuid4()))


def respond(pos):
    return node("Respond", "n8n-nodes-base.respondToWebhook", 1.1,
                {"respondWith": "json", "responseBody": "={{ $json }}",
                 "options": {"responseHeaders": {"entries": [{"name": "Access-Control-Allow-Origin", "value": "*"}]}}},
                pos)


def chain(*names):
    c = {}
    for a, b in zip(names, names[1:]):
        c.setdefault(a, {"main": [[]]})["main"][0].append({"node": b, "type": "main", "index": 0})
    return c


def workflow(name, nodes, connections):
    return {"name": name, "nodes": nodes, "connections": connections, "active": False,
            "settings": {"executionOrder": "v1"}, "pinData": {}}


CONFIG_JS = """
// HACKATHON CONFIG - paste values here inside n8n. Never commit real keys to git.
const body = $input.first().json.body || {};
return [{ json: {
  ENGINE_URL: 'https://YOUR-ENGINE-TUNNEL.trycloudflare.com',   // cloudflared tunnel --url http://localhost:8000
  ANTHROPIC_API_KEY: 'PASTE_KEY',
  LLM_MODEL: 'claude-haiku-5-5',            // fast + cheap; swap to claude-sonnet-5-5 for nicer prose
  ELEVEN_API_KEY: 'PASTE_KEY',
  ELEVEN_VOICE_ID: 'PASTE_VOICE_ID',        // ElevenLabs -> Voices -> copy voice ID
  ELEVEN_MODEL: 'eleven_multilingual_v2',   // multilingual: same voice speaks Urdu, Polish, etc.
  TELEGRAM_CHAT_ID: 'PASTE_CHAT_ID',
  req: body,
}}];
"""

ANTHROPIC_HEADERS = {
    "x-api-key": "={{ $('Config').first().json.ANTHROPIC_API_KEY }}",
    "anthropic-version": "2023-06-01",
}

# ---------------------------------------------------------------- 1. chat
INTENT_JS = r"""
const cfg = $('Config').first().json;
const req = cfg.req;
const summary = $input.first().json;
const streams = summary.recurring.map(r => `${r.stream_id} | ${r.label} | ${r.cadence} | ${r.direction} | £${r.amount}`).join('\n');
const invoices = (summary.invoices || []).map(i => `${i.id} | ${i.client} | £${i.amount} | due ${i.due} | ${i.status}`).join('\n') || 'none';

const system = `You are the planning step of Foresight, an AI accountant for ${summary.mode === 'business' ? 'small businesses' : 'individuals and families'}.
Convert the user's latest message into a tool call for the forecasting engine. Do not answer the user.

Return ONLY a JSON object, no prose, no code fences:
{"intent": "overview|forecast|upcoming|whatif|fix|spending|cashflow|invoices|chase_invoice|explain|general",
 "adjustments": [ ...zero or more adjustment objects... ],
 "language": "<ISO code of the user's language>"}

Adjustment vocabulary (use ONLY these shapes):
{"type":"cut_spend","weekly":<£>}
{"type":"shift_stream","stream_id":"<id>","days":<int>}
{"type":"remove_stream","stream_id":"<id>"}
{"type":"scale_stream","stream_id":"<id>","factor":<0..2>}
{"type":"income_change","factor":<0..2>}
{"type":"one_off","amount":<signed £>,"in_days":<int>,"label":"<short>"}
{"type":"invoice_on_time"}  {"type":"invoice_finance","advance":0.8}  {"type":"client_late","extra_days":<int>}

Rules:
- Only use stream_id values from the list below. If unsure which stream, prefer income_change / one_off.
- "What if" questions -> intent "whatif" with adjustments. Plain questions -> no adjustments.
- Costs are negative amounts, money in is positive.

Known recurring streams (id | label | cadence | direction | amount):
${streams}

Unpaid invoices:
${invoices}`;

const history = (req.history || []).slice(-6).filter(m => m.role && m.content);
return [{ json: { body: {
  model: cfg.LLM_MODEL, max_tokens: 400, system,
  messages: [...history, { role: 'user', content: req.message || 'Give me an overview' }]
}}}];
"""

PARSE_JS = r"""
const cfg = $('Config').first().json;
const raw = $input.first().json.content?.[0]?.text || '{}';
let plan;
try { plan = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
catch (e) { plan = { intent: 'general', adjustments: [], language: 'en', planner_failed: true }; }
const allowed = new Set(['cut_spend','shift_stream','remove_stream','scale_stream','income_change',
                         'one_off','invoice_on_time','invoice_finance','client_late']);
plan.adjustments = (plan.adjustments || []).filter(a => a && allowed.has(a.type));
return [{ json: { plan, simulate_body: { profile_id: cfg.req.profile_id, days: 90, adjustments: plan.adjustments } } }];
"""

REPLY_JS = r"""
const cfg = $('Config').first().json;
const plan = $('Parse intent').first().json.plan;
const summary = $('Engine summary').first().json;
const sim = $input.first().json;
const f = sim.scenario;
const facts = {
  who: { name: summary.name, mode: summary.mode, tagline: summary.tagline },
  balance_now: f.balance_now, hero: f.hero,
  scenario_applied: plan.adjustments, baseline_risk: sim.baseline, change_to_most_urgent_alert: sim.focus_alert,
  risk_now: f.risk_summary,
  alerts: f.alerts.map(a => ({ title: a.title, peak_date: a.peak_date, chance_below_zero: a.p_negative,
                               why: a.explanation, best_fixes: (a.actions || []).map(x => ({ fix: x.label, chance_after: x.new_p_negative })) })),
  upcoming_30_days: f.upcoming,
  spending_last_90_days: summary.categories_90d.slice(0, 6),
  monthly_in_out: summary.monthly.slice(-6),
  unpaid_invoices: summary.invoices,
};
const tone = summary.mode === 'business'
  ? 'a sharp, friendly startup accountant: direct, numbers-first, practical'
  : 'a warm, plain-spoken money coach for someone who may be stretched: no jargon, no judgement';
const system = `You are Foresight, ${tone}. Today is ${f.as_of}.
Use ONLY numbers from FACTS. Never invent figures, dates or names. Round money to the nearest pound.
Express chances simply ("about 3 in 10 of the futures we simulated"). This is guidance, not regulated financial advice.
If the user seems in hardship, mention free help (MoneyHelper, StepChange, Citizens Advice) and talking to their bank early.
Reply in the user's language (detected: ${plan.language || 'en'}).

Return ONLY JSON, no code fences:
{"reply": "<markdown, max 120 words, lead with the answer>",
 "speak": "<max 45 words, natural spoken English or the user's language, no markdown, no symbols>",
 "blocks": [<ordered subset of: "kpis","forecast_chart","scenario_delta","alert","actions","category_chart","cashflow_chart","upcoming","invoices">]}
Pick 1-3 blocks that best show the answer. What-ifs: "scenario_delta" + "forecast_chart". Spending: "category_chart".
Payments due / bills / what's coming up: "upcoming" (list the biggest 3 with dates and the total going out).
Overview: "kpis" + "forecast_chart" + "alert". Invoices: "invoices".

FACTS:
${JSON.stringify(facts)}`;
return [{ json: { body: { model: cfg.LLM_MODEL, max_tokens: 700, system,
  messages: [{ role: 'user', content: cfg.req.message || 'Give me an overview' }] } } }];
"""

ASSEMBLE_JS = r"""
const cfg = $('Config').first().json;
const plan = $('Parse intent').first().json.plan;
const summary = $('Engine summary').first().json;
const sim = $('Engine simulate').first().json;
const f = sim.scenario;
let out;
try { out = JSON.parse(($input.first().json.content?.[0]?.text || '').replace(/```json|```/g, '').trim()); }
catch (e) { out = { reply: "Here's where things stand.", speak: "Here's where things stand.", blocks: ['kpis', 'forecast_chart'], fallback: true }; }

const fill = {
  kpis: () => ({ type: 'kpis', items: [{ label: f.hero.label, value: f.hero.value, unit: f.hero.unit }, ...(f.hero.kpis || [])] }),
  forecast_chart: () => ({ type: 'forecast_chart', data: { history: f.history, bands: f.bands, alerts: f.alerts } }),
  scenario_delta: () => sim.focus_alert ? ({ type: 'scenario_delta', focus: sim.focus_alert }) : null,
  alert: () => f.alerts[0] ? ({ type: 'alert', alert: f.alerts[0] }) : null,
  actions: () => f.alerts[0]?.actions?.length ? ({ type: 'actions', actions: f.alerts[0].actions }) : null,
  category_chart: () => ({ type: 'category_chart', data: summary.categories_90d }),
  cashflow_chart: () => ({ type: 'cashflow_chart', data: summary.monthly }),
  upcoming: () => ({ type: 'upcoming', items: f.upcoming }),
  invoices: () => summary.invoices?.length ? ({ type: 'invoices', items: summary.invoices }) : null,
};
const blocks = (out.blocks || []).map(t => fill[t] ? fill[t]() : null).filter(Boolean);
const speak = cfg.req.voice === false ? '' : (out.speak || '');
return [{ json: {
  reply: out.reply, speak, intent: plan.intent, adjustments: plan.adjustments,
  blocks: blocks.length ? blocks : [fill.kpis(), fill.forecast_chart()],
  data_notes: [plan.planner_failed && 'I could not fully understand the question, so here is the overview.',
               out.fallback && 'The AI writer was unavailable, so this is a standard summary.'].filter(Boolean),
  tts_body: { text: speak || ' ', model_id: cfg.ELEVEN_MODEL },
}}];
"""

ATTACH_JS = r"""
const out = $('Assemble response').first().json;
let audio_base64 = null;
try {
  if (out.speak) audio_base64 = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('base64');
} catch (e) { /* TTS failed or skipped - UI falls back to text only */ }
const { tts_body, ...rest } = out;
const data_notes = [...(out.data_notes || [])];
if (out.speak && !audio_base64) data_notes.push('Voice was unavailable, so this answer is text only.');
return [{ json: { ...rest, audio_base64, audio_mime: 'audio/mpeg', data_notes } }];
"""

ELEVEN_URL = "=https://api.elevenlabs.io/v1/text-to-speech/{{ $('Config').first().json.ELEVEN_VOICE_ID }}?output_format=mp3_44100_128"
ELEVEN_HEADERS = {"xi-api-key": "={{ $('Config').first().json.ELEVEN_API_KEY }}"}

chat_nodes = [
    webhook("accountant-chat", [0, 300]),
    code("Config", CONFIG_JS, [220, 300]),
    http("Engine summary", "GET", "={{ $json.ENGINE_URL }}/profiles/{{ $json.req.profile_id }}/summary", [440, 300]),
    code("Build intent prompt", INTENT_JS, [660, 300]),
    http("LLM: plan", "POST", ANTHROPIC_URL, [880, 300], "={{ JSON.stringify($json.body) }}", ANTHROPIC_HEADERS),
    code("Parse intent", PARSE_JS, [1100, 300]),
    http("Engine simulate", "POST", "={{ $('Config').first().json.ENGINE_URL }}/simulate", [1320, 300],
         "={{ JSON.stringify($json.simulate_body) }}"),
    code("Build reply prompt", REPLY_JS, [1540, 300]),
    http("LLM: reply", "POST", ANTHROPIC_URL, [1760, 300], "={{ JSON.stringify($json.body) }}", ANTHROPIC_HEADERS),
    code("Assemble response", ASSEMBLE_JS, [1980, 300]),
    http("ElevenLabs TTS", "POST", ELEVEN_URL, [2200, 300], "={{ JSON.stringify($json.tts_body) }}",
         ELEVEN_HEADERS, file_response=True, on_error="continueRegularOutput"),
    code("Attach audio", ATTACH_JS, [2420, 300]),
    respond([2640, 300]),
]
chat = workflow("Foresight - Accountant chat", chat_nodes, chain(*[n["name"] for n in chat_nodes]))

# ---------------------------------------------------------------- 2. daily alerts -> Telegram voice notes
SPLIT_JS = r"""
return $input.first().json.profiles.map(p => ({ json: { profile_id: p.profile_id, name: p.name, mode: p.mode } }));
"""
ALERT_TEXT_JS = r"""
// Keep only profiles with an alert; write the voice-note script (deterministic, no LLM needed)
const out = [];
for (const [i, item] of $input.all().entries()) {
  const f = item.json;
  const who = $('Split profiles').all()[i].json;
  const a = f.alerts?.[0];
  if (!a) continue;
  const chance = Math.round(a.p_negative * 10);
  const fix = a.actions?.[0];
  const when = new Date(a.peak_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  let text;
  if (f.mode === 'business') {
    text = `Good morning ${who.name}. Your cash runway is ${f.hero.value ?? 'healthy'} weeks. ` +
           `Heads up for ${when}: ${a.title.toLowerCase()}. In ${chance} out of 10 futures we simulated, cash dips below zero. ` +
           (fix ? `Best fix: ${fix.label.toLowerCase()}. That cuts the risk to ${Math.round(fix.new_p_negative * 10)} in 10.` : '');
  } else {
    text = `Hi ${who.name}, a quick heads up. Around ${when}, there's a ${chance} in 10 chance your balance goes below zero. ` +
           (fix ? `If you ${fix.label.charAt(0).toLowerCase() + fix.label.slice(1)}, that drops to ${Math.round(fix.new_p_negative * 10)} in 10. ` : '') +
           `Open Foresight to see the details.`;
  }
  out.push({ json: { profile_id: who.profile_id, text, caption: `${who.name}: ${a.title}`,
                     tts_body: { text, model_id: $('Config').first().json.ELEVEN_MODEL } } });
}
return out;
"""
alert_nodes = [
    node("Every morning 8am", "n8n-nodes-base.scheduleTrigger", 1.2,
         {"rule": {"interval": [{"field": "cronExpression", "expression": "0 8 * * *"}]}}, [0, 200]),
    node("Run now (demo)", "n8n-nodes-base.manualTrigger", 1, {}, [0, 400]),
    code("Config", CONFIG_JS, [220, 300]),
    http("Engine profiles", "GET", "={{ $json.ENGINE_URL }}/profiles", [440, 300]),
    code("Split profiles", SPLIT_JS, [660, 300]),
    http("Engine forecast", "POST", "={{ $('Config').first().json.ENGINE_URL }}/forecast", [880, 300],
         "={{ JSON.stringify({ profile_id: $json.profile_id, days: 60 }) }}"),
    code("Alerts only", ALERT_TEXT_JS, [1100, 300]),
    http("ElevenLabs TTS", "POST", ELEVEN_URL, [1320, 300], "={{ JSON.stringify($json.tts_body) }}",
         ELEVEN_HEADERS, file_response=True),
    node("Telegram voice note", "n8n-nodes-base.telegram", 1.2,
         {"operation": "sendAudio", "chatId": "={{ $('Config').first().json.TELEGRAM_CHAT_ID }}",
          "binaryData": True, "binaryPropertyName": "data",
          "additionalFields": {"caption": "={{ $('Alerts only').item.json.caption }}"}}, [1540, 300]),
]
alert_conn = chain("Config", "Engine profiles", "Split profiles", "Engine forecast", "Alerts only",
                   "ElevenLabs TTS", "Telegram voice note")
alert_conn["Every morning 8am"] = {"main": [[{"node": "Config", "type": "main", "index": 0}]]}
alert_conn["Run now (demo)"] = {"main": [[{"node": "Config", "type": "main", "index": 0}]]}
alerts = workflow("Foresight - Daily voice alerts (Telegram)", alert_nodes, alert_conn)

# ---------------------------------------------------------------- 3. invoice chaser (draft)
CHASE_PROMPT_JS = r"""
const cfg = $('Config').first().json;
const s = $input.first().json;
const inv = (s.invoices || []).find(i => i.id === cfg.req.invoice_id) || (s.invoices || [])[0];
if (!inv) return [{ json: { body: null, invoice: null } }];
const tone = cfg.req.tone === 'firm' ? 'polite but firm, mention the agreed terms' : 'warm and friendly, assume it was an oversight';
return [{ json: { invoice: inv, body: {
  model: cfg.LLM_MODEL, max_tokens: 500,
  system: `Write a short payment reminder email from ${s.name} to ${inv.client}. Tone: ${tone}. UK English. Max 110 words.
Return ONLY JSON: {"subject": "...", "body": "..."} (plain text body, sign off as "The ${s.name} team").`,
  messages: [{ role: 'user', content: `Invoice ${inv.id}, amount £${inv.amount}, issued ${inv.issued}, due ${inv.due}, status ${inv.status}, ${inv.days_late ?? 0} days late.` }]
}}}];
"""
CHASE_PARSE_JS = r"""
const inv = $('Build chase prompt').first().json.invoice;
let out;
try { out = JSON.parse(($input.first().json.content?.[0]?.text || '').replace(/```json|```/g, '').trim()); }
catch (e) { out = { subject: `Invoice ${inv?.id} reminder`, body: 'Draft failed - please write manually.' }; }
return [{ json: { ...out, invoice: inv } }];
"""
chase_nodes = [
    webhook("chase-invoice", [0, 300]),
    code("Config", CONFIG_JS, [220, 300]),
    http("Engine summary", "GET", "={{ $json.ENGINE_URL }}/profiles/{{ $json.req.profile_id }}/summary", [440, 300]),
    code("Build chase prompt", CHASE_PROMPT_JS, [660, 300]),
    http("LLM: draft", "POST", ANTHROPIC_URL, [880, 300], "={{ JSON.stringify($json.body) }}", ANTHROPIC_HEADERS),
    code("Parse draft", CHASE_PARSE_JS, [1100, 300]),
    respond([1320, 300]),
]
chase = workflow("Foresight - Invoice chaser (draft)", chase_nodes, chain(*[n["name"] for n in chase_nodes]))

# ---------------------------------------------------------------- 4. send email (human-approved)
ALLOWLIST_JS = r"""
// SAFETY: this webhook is public (its URL is in the browser bundle). Only allowlisted addresses
// get real email; anything else is redirected to the team demo inbox with a note.
const ALLOWED = ['PASTE_TEAM_EMAIL_1', 'PASTE_TEAM_EMAIL_2'];
const DEMO_INBOX = 'PASTE_TEAM_EMAIL_1';
const b = $input.first().json.body || {};
const to = String(b.to || '').trim().toLowerCase();
const ok = ALLOWED.map(x => x.toLowerCase()).includes(to);
return [{ json: {
  to: ok ? to : DEMO_INBOX,
  subject: String(b.subject || 'Payment reminder').slice(0, 150),
  body: (ok ? '' : `[Demo: originally addressed to ${to || 'nobody'}]\n\n`) + String(b.body || '').slice(0, 3000),
  redirected: !ok,
}}];
"""
send_nodes = [
    webhook("send-email", [0, 300]),
    code("Recipient allowlist", ALLOWLIST_JS, [220, 300]),
    node("Gmail send", "n8n-nodes-base.gmail", 2.1,
         {"sendTo": "={{ $json.to }}", "subject": "={{ $json.subject }}",
          "emailType": "text", "message": "={{ $json.body }}", "options": {}}, [440, 300],
         retryOnFail=True, maxTries=2),
    code("OK", "const a = $('Recipient allowlist').first().json; return [{ json: { ok: true, sent_to: a.to, redirected: a.redirected } }];", [660, 300]),
    respond([880, 300]),
]
send = workflow("Foresight - Send email", send_nodes, chain(*[n["name"] for n in send_nodes]))

for fname, wf in [("01_accountant_chat.json", chat), ("02_daily_voice_alerts.json", alerts),
                  ("03_invoice_chaser.json", chase), ("04_send_email.json", send)]:
    (OUT / fname).write_text(json.dumps(wf, indent=2))
    print("wrote", fname)
