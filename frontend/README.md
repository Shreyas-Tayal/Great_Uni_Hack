# Foresight web app

A chat-first AI accountant. Vite + React + TypeScript + Tailwind, no Lovable needed.

```bash
npm install
cp .env.example .env.local    # VITE_ENGINE_URL=http://localhost:8000
npm run dev                   # http://localhost:5173
npm run build                 # static site in dist/, host it anywhere
```

**How it looks:** a money terminal. Near-black panels with amber labels (or a light "paper" mode), IBM Plex Mono for
figures and IBM Plex Sans for sentences, a ticker line of vital signs, a watchlist of accounts, and tabs
(Alt+1 to Alt+7 switch between them):

| Tab | What's there |
|---|---|
| 1 ASK | The conversation, plus pre-answered questions beside it on wide screens |
| 2 ANSWERS | Pre-answered questions: a live "Can I spend £___?" check, safe-to-spend, Christmas, tightest day, next money in, this week's bills (business: runway, payroll, who owes me) |
| 3 FORECAST | 90-day forecast with time travel, and every alert with its tested fixes |
| 4 PLAN | Fixes to approve, "Handled for you" (with undo), practise-the-call |
| 5 BILLS | Next 30 days, every regular payment the engine detected, invoices for businesses |
| 6 SPENDING | Where money went, and in/out by month |
| 7 PROFILE | The account as a profile: account type, money in/out, bills, standing (no job descriptions) |

**How it behaves**
- Opens with a briefing for the selected account: balance today, the tightest spot, and fixes already tested.
- Pre-answered questions are computed from the forecast; the spend check re-runs the simulation with the purchase added.
- **Approve** a fix and the accountant adds it to the plan, re-runs the forecast, and prepares the follow-ups
  (a drafted letter to the landlord, a spending target, a reminder to pause a subscription, HMRC Time to Pay steps).
  These are tracked under **Handled for you**; undo removes them. It never sends or pays anything by itself.
- Questions go to n8n (`VITE_N8N_URL`) → the engine's `/chat` (Claude, needs `ANTHROPIC_API_KEY` on the engine)
  → the built-in coach in `src/lib/localCoach.ts`. The watchlist footer shows which one is answering.
- Leave `VITE_ENGINE_URL` empty to run entirely on `src/mocks/` (saved engine output).

**Where things are**
- `src/pages/Index.tsx`: layout, tabs and state (accounts, conversation, approvals, scenario).
- `src/components/Terminal.tsx`: panels, ticker, tabs, watchlist, quick answers, ledgers, profile.
- `src/lib/quick.ts`: the pre-answered questions.
- `src/lib/plan.ts`: the briefing and what happens after an approval.
- `src/lib/api.ts`: engine and n8n calls, demo-mode fallbacks, chat routing.
- `src/components/`: also `Conversation` and `BlockRenderer` (charts and cards inside replies).
- `src/foresight.css`: colours, fonts, terminal and paper themes.
