# Foresight: an AI accountant that sees your money 90 days early

AI-first UI for personal and small-business finances. Ask in plain words (or by voice);
the accountant answers with charts, risk and one-tap fixes, grounded in a Monte Carlo forecast.

```
foresight/
├── contracts/            ← READ FIRST. The shared API + block contract. Change only by agreement.
├── data/profiles/        ← 5 synthetic demo accounts (generated, deterministic)
├── engine/               ← Person 1: Python forecast engine + FastAPI
├── n8n/                  ← Person 3: importable workflows (chat, voice alerts, invoice chaser, email)
└── frontend/             ← Person 2: React components for Lovable (+ LOVABLE_PROMPT.md)
```

## Who does what

| | Person 1: Engine | Person 2: UI (Lovable) | Person 3: AI + n8n + voice |
|---|---|---|---|
| Owns | `engine/`, `data/` | `frontend/` | `n8n/`, prompts, ElevenLabs, pitch |
| Hour 0-1 | Run engine, start tunnel, share URL | Paste `LOVABLE_PROMPT.md`, connect GitHub, drop in `src/` | Import 4 workflows, fill Config nodes, get Anthropic + ElevenLabs keys |
| Hours 1-8 | Tune personas so each has a clear cliff; improve recurring detection | Build against mocks (works with zero backend) | Get chat webhook returning blocks + audio end to end |
| Hours 8-16 | New adjustments the AI asks for; speed | Polish chart, scenario animation, mobile | Telegram voice alerts, invoice chaser, ElevenLabs practice-call agent |
| Hours 16-end | Freeze. Cache demo outputs | Freeze. Fix bugs only | Slides, demo script, rehearse x3 |

**Rule:** UI works on mocks from minute one, so nobody waits on anybody.

## Run it

### Engine (Person 1)
```bash
cd engine
pip install -r requirements.txt
python generate_data.py --out ../data/profiles     # already done; rerun after tuning personas
uvicorn main:app --reload --port 8000              # http://localhost:8000/docs
cloudflared tunnel --url http://localhost:8000     # public URL for n8n + Lovable (or: ngrok http 8000)
```
Test: `curl -X POST localhost:8000/forecast -H 'content-type: application/json' -d '{"profile_id":"corner_cup"}'`

### n8n (Person 3)
1. n8n → Workflows → Import from file → each JSON in `n8n/`.
2. Open the **Config** node in each, paste: engine tunnel URL, Anthropic key, ElevenLabs key + voice ID, Telegram chat ID.
3. Gmail and Telegram nodes: select or create credentials once.
4. Activate `Accountant chat`, `Invoice chaser`, `Send email`. Use the manual trigger on `Daily voice alerts` for the demo.
5. Edit prompts in n8n directly, or in `build_workflows.py` then `python build_workflows.py` and re-import.

> Keys live only inside n8n. Never commit them.

### Frontend (Person 2)
1. Create the Lovable project with `frontend/LOVABLE_PROMPT.md`.
2. Connect Lovable to GitHub (two-way sync), then copy `frontend/src/*` into the repo's `src/`.
3. Lovable → project settings → environment: `VITE_ENGINE_URL`, `VITE_N8N_URL`, optional `VITE_ELEVEN_AGENT_ID`.
   With none set, the app runs on real engine output saved as mocks.

## Demo accounts
| id | Mode | Built-in story |
|---|---|---|
| `amara` | Personal | Single parent on UC: rent lands before wages; Christmas + BNPL squeeze |
| `jay` | Personal | Gig rider: irregular weekly pay, January self-assessment bill |
| `sam` | Personal | Student: runs dry before the January loan instalment |
| `corner_cup` | Business | Café: VAT on 8 Dec + quarterly rent on 24 Dec, late-paying catering client |
| `lumen_labs` | Business | SaaS startup: ~10-month runway, £18k enterprise invoice overdue |

## How the engine works (for the pitch)
1. **Detect** recurring flows from raw bank text (rent, wages, VAT, payouts), no labels needed.
2. **Simulate** 1,000 futures: fixed bills on schedule + day-to-day spending replayed from the person's own
   history, adjusted for seasonality (last December tells us about this December), with uncertain invoice dates.
3. **Measure** risk as the chance the balance goes below £0 on each day ("financial time travel").
4. **Fix**: re-run the simulation with each candidate fix (same random draws, so the difference is the fix) and rank them.
5. **Explain**: the LLM only chooses words and which charts to show; every number comes from the engine.

Recurring detection is scored against hidden ground truth in the data (`detection_score` in `/summary`). Quote it.
