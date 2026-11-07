# Final setup: engine + web app + ElevenLabs + n8n (about 40 minutes)

Do the steps in this order. Each one ends with a test, so you always know what's working.

```
Web app (React, chat-first) ──(forecasts, fixes, /chat)──► Engine (FastAPI) ──► Claude API
     │                                                      ▲
     └──(optional: voice, emails)──► n8n ───────────────────┘──► Claude API, ElevenLabs, Telegram, Gmail
```
The chat answers from the first route that works: n8n (if `VITE_N8N_URL` is set) → the engine's `/chat` (if
`ANTHROPIC_API_KEY` is set on the engine) → the built-in coach (no AI, always works). n8n is optional now.

---

## 1. Engine online (Person 1, 10 min)

**Option A: tunnel from a laptop (quickest)**
```bash
cd engine
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
# new terminal:
cloudflared tunnel --url http://localhost:8000      # prints https://something.trycloudflare.com
```
Quick tunnels get a **new URL every restart**. If you restart, update the URL in n8n (Config nodes) and in `frontend/.env.local`.

**Option B: deploy for judging (stable URL).** Push the repo to GitHub → Render.com → New Web Service
→ root directory `engine` → build `pip install -r requirements.txt` → start
`uvicorn main:app --host 0.0.0.0 --port $PORT`. Free tier sleeps when idle, so open `/health` 2 minutes before you present.

**Test:**
```bash
curl https://ENGINE/health
curl -X POST https://ENGINE/forecast -H 'content-type: application/json' -d '{"profile_id":"corner_cup"}' | head -c 400
```

---

## 2. ElevenLabs (Person 3, 10 min)

1. Sign up at elevenlabs.io.
2. **API key:** profile menu → API keys → create one (text-to-speech access is enough for n8n).
3. **Voice ID:** Voices → pick a warm, clear voice → copy its Voice ID.
4. **Practice-call agent (optional but memorable):** Conversational AI / Agents → create a blank agent →
   paste the first message and system prompt from `contracts/rehearsal_agent_prompt.md` → choose a voice →
   make sure the agent can be used publicly from a website (no authentication; if there's a domain allowlist,
   add the domain where the web app is hosted) → copy the **Agent ID**.

**Test:** in the agent page, use the built-in test call.

---

## 3. n8n (Person 3, 15 min)

Use **n8n Cloud** (free trial) so webhooks are public with no tunnel.

1. Workflows → Import from file → import all four files in `n8n/`.
2. In **each** workflow, open the **Config** node and paste:
   `ENGINE_URL`, `ANTHROPIC_API_KEY`, `ELEVEN_API_KEY`, `ELEVEN_VOICE_ID`, `TELEGRAM_CHAT_ID`.
   If the Claude API rejects the model name, change `LLM_MODEL` there.
3. **Telegram** (daily voice alerts): in Telegram, message @BotFather → `/newbot` → copy the token →
   in n8n, create a Telegram credential with it and select it on the "Telegram voice note" node.
   Send your bot any message, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`.
4. **Gmail** (send email): select or create a Gmail OAuth credential on the "Gmail send" node.
5. **Activate** the chat, invoice chaser and send email workflows (toggle top right).
   Live URLs use `/webhook/...`. The `/webhook-test/...` URLs only work while you click "Listen for test event".

**Test chat end to end:**
```bash
curl -X POST https://YOU.app.n8n.cloud/webhook/accountant-chat \
  -H 'content-type: application/json' \
  -d '{"profile_id":"corner_cup","mode":"business","message":"What if Halden pays a month late?","history":[],"voice":true}' \
  | head -c 600
```
You should see `reply`, `blocks` and a long `audio_base64`. If audio is `null`, check the ElevenLabs key and voice ID.

**Test voice alerts:** open "Daily voice alerts", click Execute workflow. Your phone should get a voice note.

**Test invoice chaser:**
```bash
curl -X POST https://YOU.app.n8n.cloud/webhook/chase-invoice -H 'content-type: application/json' \
  -d '{"profile_id":"corner_cup","invoice_id":"INV-1013","tone":"friendly"}'
```
(Any invoice ID works; it falls back to the first unpaid one.)

---

## 4. AI chat on the engine (Person 1, 2 min)

```bash
export ANTHROPIC_API_KEY=sk-ant-...        # stays on the server, never in the browser
export ANTHROPIC_MODEL=claude-sonnet-5-5   # optional; any current Claude model id works
uvicorn main:app --port 8000
```
**Test:** `curl localhost:8000/health` shows `"ai_chat": true`, and
`curl -X POST localhost:8000/chat -H 'content-type: application/json' -d '{"profile_id":"amara","message":"how am I looking?"}'`
returns a `reply` and `blocks`. Without a key, `/chat` returns 503 and the app uses its built-in coach.

## 5. Web app (Person 2, 10 min)

```bash
cd frontend
npm install
cp .env.example .env.local     # set VITE_ENGINE_URL (and VITE_N8N_URL / VITE_ELEVEN_AGENT_ID if you use them)
npm run dev                    # http://localhost:5173
```
Leave `VITE_ENGINE_URL` empty to run on the saved demo data in `src/mocks/` (no engine needed).
To host it: `npm run build` and deploy `frontend/dist/` to any static host (Vercel, Netlify, Render static site,
Cloudflare Pages). Set the same `VITE_...` variables in the host's build settings.

**Test in the browser:**
- The accountant opens with a briefing: today's balance, the tightest spot, and fixes it has tested.
- Tap **Approve** on a fix: the forecast redraws with a dashed "before" line, a before/after risk card appears,
  and the follow-ups land in **Handled for you** on the left (e.g. a drafted letter to the landlord). Undo removes it.
- Ask "What if my boiler breaks next week?": the answer has charts and the forecast panel shows "Exploring".
- The bottom-left corner says which brain is answering (n8n, Claude, or the built-in coach).
- Switch accounts in the left rail, toggle dark mode, and drag the time-travel slider in the forecast panel.
- Business → "Which invoices should I chase?" → Draft reminder.
- Click the mic and speak a question (Chrome works best).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| App says it couldn't load the forecast | Engine URL wrong or tunnel restarted. Open `ENGINE/health` in a browser. |
| Corner says "Built-in coach" | No `ANTHROPIC_API_KEY` on the engine (and no n8n). Set it and restart the engine. |
| Chat says "Couldn't reach the accountant" | Workflow not active, or you used a `/webhook-test/` URL. Check n8n → Executions for the error. |
| CORS error in browser console | Webhook node → Options → Allowed Origins `*`. The engine already allows all origins. |
| Reply works, no sound | Browser blocked autoplay until you've clicked something, or ElevenLabs key/quota. Check `audio_base64` in the network tab. |
| Claude API 400/404 | Wrong model name or key in the Config node. |
| Chat is slow (8–12 s) | Two LLM calls plus TTS. Switch `LLM_MODEL` to the fastest model; keep replies short. |
| Agent widget doesn't appear | Agent ID wrong, agent requires authentication, or the domain isn't allowlisted. |

**Safety net for the demo:** record a 60-second screen capture of the full flow once everything works.
If the venue Wi-Fi dies, play it.

---

## 3-minute demo script

1. **Problem (20 s):** "Most money apps tell you what you spent. Foresight tells you what's about to happen."
2. **Personal (60 s):** Amara. The accountant has already spoken first: "Rent lands before her money comes in:
   5 in 10 futures go overdrawn." Tap Approve and watch it cut her spending target, pause Netflix, and track it under "Handled for you". Ask by voice:
   "What if I lose my Saturday shift?" and let it answer out loud.
3. **Flip to Business (50 s):** The Corner Cup. "Same engine, different world." Rent on Christmas Eve, payroll on 30 December, drawings on 1 January:
   10 in 10 futures go below £0. Approve "move the rent 14 days and halve owner drawings": 0 in 10, and the letter to the landlord is already drafted.
4. **Proactive (20 s):** Hold up a phone and play the Telegram voice note: "It doesn't wait to be asked."
5. **How it works (20 s):** "Recurring bills detected from raw bank text, 1,000 simulated futures, every fix re-simulated.
   The AI only chooses words and charts; every number comes from the engine."
6. **Close (10 s):** "Simpler, fairer, more accessible, and 90 days early."
