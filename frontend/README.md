# Foresight web app

A chat-first AI accountant. Vite + React + TypeScript + Tailwind, no Lovable needed.

```bash
npm install
cp .env.example .env.local    # VITE_ENGINE_URL=http://localhost:8000
npm run dev                   # http://localhost:5173
npm run build                 # static site in dist/, host it anywhere
```

**How it behaves**
- Opens with a briefing for the selected account: balance today, the tightest spot, and fixes already tested.
- **Approve** a fix and the accountant adds it to the plan, re-runs the forecast, and prepares the follow-ups
  (a drafted letter to the landlord, a spending target, a reminder to pause a subscription, HMRC Time to Pay steps).
  These are tracked under **Handled for you**; undo removes them. It never sends or pays anything by itself.
- Questions go to n8n (`VITE_N8N_URL`) → the engine's `/chat` (Claude, needs `ANTHROPIC_API_KEY` on the engine)
  → the built-in coach in `src/lib/localCoach.ts`. The bottom-left corner shows which one is answering.
- Leave `VITE_ENGINE_URL` empty to run entirely on `src/mocks/` (saved engine output).

**Where things are**
- `src/pages/Index.tsx`: layout and state (accounts, conversation, approvals, scenario).
- `src/lib/plan.ts`: the briefing and what happens after an approval.
- `src/lib/api.ts`: engine and n8n calls, demo-mode fallbacks, chat routing.
- `src/components/`: `Conversation`, `Sidebar`, `GlancePanel`, `BlockRenderer` (charts and cards inside replies).
- `src/foresight.css`: colours, fonts, light and dark themes.
