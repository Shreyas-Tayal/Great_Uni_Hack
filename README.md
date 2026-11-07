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
        ├── pages/Index.tsx     ← terminal layout: watchlist | ticker | tabs (Ask, Answers, Forecast, Plan, Bills, Spending, Profile)
        ├── components/         ← Terminal (panels, quick answers, profile), Conversation, BlockRenderer, charts and cards
        ├── lib/                ← api (engine, n8n, chat routing), plan (briefing + approvals), quick (pre-answered questions), localCoach
        └── mocks/              ← saved engine output, so the app runs with no engine
```

## Setup

You run two things: the **engine** (Python, the forecasts and the AI chat) and the **web app** (the page you use).
Both run on your own computer. No API key is needed to try it: without one, a built-in coach answers questions.

**Quickest look (no Python):** skip step 2, and in step 3 don't create `.env.local`. The app then runs on saved
demo data and shows a yellow "Demo mode" bar.

### On a Mac

**1. Install the tools (once)**

Open **Terminal** (press Cmd + Space, type "Terminal", press Return) and check what you already have:
```bash
node -v      # needs v18 or newer
python3 -V   # needs 3.10 or newer
```
If either is missing or too old, the easiest way is [Homebrew](https://brew.sh):
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node python@3.12
```
(Or use the installers from [nodejs.org](https://nodejs.org) and [python.org](https://www.python.org/downloads/macos/).)
If macOS asks to install the "command line developer tools", click Install and let it finish.

**2. Start the engine (Terminal tab 1)**

Unzip `foresight.zip` (double-click it in Finder), then:
```bash
cd ~/Downloads/foresight/engine          # wherever you unzipped it
python3 -m venv .venv                    # a private Python just for this project (once)
source .venv/bin/activate                # do this every time you open a new tab for the engine
pip install -r requirements.txt          # once
uvicorn main:app --port 8000
```
Leave it running. Check it at http://localhost:8000/health: it should say `"ok": true`.

The `.venv` step matters on a Mac: Homebrew's Python refuses `pip install` outside a virtual environment
("externally-managed-environment" error).

**3. Start the web app (Terminal tab 2, press Cmd + T)**
```bash
cd ~/Downloads/foresight/frontend
npm install                              # once, takes a minute
cp .env.example .env.local               # points the app at the engine on port 8000 (once)
npm run dev
```
Open http://localhost:5173. The bottom of the watchlist says which brain is answering:
"Built-in coach (demo, no AI)" without a key, "AI accountant (Claude)" with one.

**4. Turn on the AI chat (optional, needs an Anthropic API key)**

Stop the engine in tab 1 with Ctrl + C, then:
```bash
export ANTHROPIC_API_KEY=sk-ant-...      # your key from console.anthropic.com
export ANTHROPIC_MODEL=claude-haiku-5-5  # optional: cheaper and faster than the default
uvicorn main:app --port 8000
```
`export` only lasts for that Terminal tab. To keep the key, add the `export` line to `~/.zshrc` and open a new tab.
API usage is billed through the Claude Console; a Claude Pro chat subscription doesn't include it.

**Stopping and starting again:** Ctrl + C in each tab stops it. Next time, you only need:
```bash
cd ~/Downloads/foresight/engine && source .venv/bin/activate && uvicorn main:app --port 8000
cd ~/Downloads/foresight/frontend && npm run dev
```

### On Windows

Same steps in **PowerShell**, with these differences:
```powershell
cd engine
py -m venv .venv
.venv\Scripts\Activate.ps1          # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
pip install -r requirements.txt
uvicorn main:app --port 8000

cd frontend
npm install
copy .env.example .env.local
npm run dev
```
Set the key with `$env:ANTHROPIC_API_KEY="sk-ant-..."` before starting the engine.

### On Linux

Same as the Mac steps; install Node and Python from your package manager.

### If something goes wrong

| Problem | Fix |
|---|---|
| `command not found: npm` or `node` | Node isn't installed, or Terminal was open before you installed it. Open a new tab. |
| `externally-managed-environment` when running pip | You skipped the `.venv` step, or forgot `source .venv/bin/activate` in this tab. |
| `command not found: uvicorn` | Same: activate the `.venv` first. |
| App says it couldn't load the accounts | The engine isn't running, or `.env.local` points somewhere else. Check http://localhost:8000/health. |
| `Address already in use` | Something else has that port. Use `--port 8001` for the engine (and update `.env.local`), or `npm run dev -- --port 5174`. |
| Chat says "Built-in coach" after adding a key | The engine was started in a tab without the `export`. Stop it, export the key in that tab, start it again. |
| Changed `.env.local` but nothing happened | Stop `npm run dev` with Ctrl + C and start it again. |

Voice (ElevenLabs) and n8n are optional extras: see `FINAL_SETUP.md`.

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
