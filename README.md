# Foresight: a personal AI accountant that sees your money 90 days early

A chat-first AI accountant for personal and small-business finances. It opens with a briefing on what it has spotted,
answers in plain words (or by voice) with charts and risk, and handles the follow-through: you approve a fix and it
updates your plan, drafts the letter or reminder, and tracks what is left to do. Every number comes from a Monte Carlo forecast.
Built for GreatUniHack 2026, NatWest challenge: AI-Powered Financial Inclusion & Resilience.

## Folder structure

```
foresight/
├── README.md                  ← you are here
├── FINAL_SETUP.md             ← step-by-step: engine → AI chat → web app → ElevenLabs → n8n, with tests + demo script
├── contracts/
│   ├── CONTRACT.md            ← shared API, adjustments and chat-block contract (read first)
│   └── rehearsal_agent_prompt.md   ← ElevenLabs "Practise the call" agent prompt
├── data/profiles/             ← 7 synthetic demo accounts + index.json (generated, deterministic)
├── engine/                    ← Python forecast engine + FastAPI
│   ├── main.py                ← API: /profiles, /profiles/{id}/summary, /forecast, /simulate, /chat
│   ├── generate_data.py       ← builds data/profiles
│   ├── requirements.txt
│   └── foresight/
│       ├── recurring.py       ← detects bills/income from raw bank text
│       ├── engine.py          ← Monte Carlo forecast, alerts, ranked fixes
│       ├── accountant.py      ← the AI accountant behind /chat (Claude; prompt, facts, blocks)
│       └── modes.py           ← personal vs business settings and categories
├── n8n/                       ← importable workflows (chat, voice alerts, invoice chaser, send email)
│   └── build_workflows.py     ← regenerates the workflow JSON
└── frontend/                  ← the chat-first web app (Vite + React + TypeScript + Tailwind)
    ├── package.json, vite.config.ts, index.html, .env.example
    └── src/
        ├── pages/Index.tsx     ← layout: accounts + "handled for you" | conversation | forecast panel
        ├── components/         ← Conversation, Sidebar, GlancePanel, BlockRenderer, charts and cards
        ├── lib/                ← api (engine, n8n, chat routing), plan (briefing + approvals), localCoach
        └── mocks/              ← saved engine output, so the app runs with no engine
```

## Quick start

```bash
cd engine
pip install -r requirements.txt
uvicorn main:app --reload --port 8000        # http://localhost:8000/docs
```
```bash
cd frontend
npm install
cp .env.example .env.local      # VITE_ENGINE_URL=http://localhost:8000
npm run dev                      # http://localhost:5173
```
Set `ANTHROPIC_API_KEY` on the engine to turn on the AI chat. Without it, the built-in coach answers.
Then follow `FINAL_SETUP.md` for voice (ElevenLabs) and n8n, both optional.

## Who does what

| Person 1: Engine + AI chat | Person 2: Web app | Person 3: n8n + voice |
|---|---|---|
| `engine/`, `data/` | `frontend/` | `n8n/`, prompts, ElevenLabs, pitch |

## Demo accounts

| id | Mode | Story | Peak risk |
|---|---|---|---|
| `amara` | Personal | Single parent on UC: rent before payday, Christmas squeeze | 8 in 10 |
| `sam` | Personal | Student between loan instalments | 3 in 10 |
| `margaret` | Personal | Pensioner: winter energy bills, thin buffer but managing | Safe |
| `jay` | Personal | Gig rider: irregular weekly pay, comfortable | Safe |
| `corner_cup` | Business | Café: rent, payroll and drawings collide at New Year | 8 in 10 → 0 with "Do both" fix |
| `fixit_plumbing` | Business | Sole-trader plumber: busy winters, £5,600 January tax bill | 6 in 10 → 0 with fix |
| `lumen_labs` | Business | Startup with 43 weeks of runway | Safe |

Change which accounts appear with the `DEMO_PROFILES` environment variable on the engine.

## How the engine works (for the pitch)
1. **Detect** recurring flows from raw bank text (rent, wages, VAT, payouts), no labels needed.
2. **Simulate** 1,000 futures: fixed bills on schedule + day-to-day spending replayed from the person's own
   history, adjusted for seasonality (last December tells us about this December), with uncertain invoice dates.
3. **Measure** risk as the chance the balance goes below £0 on each day ("financial time travel").
4. **Fix**: re-run the simulation with each candidate fix (same random draws, so the difference is the fix) and rank them.
5. **Explain**: the LLM only chooses words and which charts to show; every number comes from the engine.

Recurring detection is scored against hidden ground truth in the data (`detection_score` in `/summary`). Quote it.
