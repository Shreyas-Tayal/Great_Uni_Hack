// Terminal layout: watchlist on the left, a ticker line of vital signs, and tabs for each job.
// ASK is the conversation (with pre-answered questions beside it); approving a fix anywhere updates the plan.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Adjustment, Approval, ChatMessage, Forecast, ProfileSummary, SimulateResponse, Summary } from "@/lib/types";
import { type Brain, SUGGESTIONS, USING_MOCKS, chat, detectBrain, getForecast, getProfiles, getSummary, playAudio, simulate } from "@/lib/api";
import { briefing, onApprove, plain } from "@/lib/plan";
import { useTheme } from "@/hooks/useTheme";
import Conversation from "@/components/Conversation";
import ForecastChart from "@/components/ForecastChart";
import TimeTravel from "@/components/TimeTravel";
import { AlertCard, ScenarioDelta } from "@/components/Cards";
import { CashflowChart, CategoryChart, InvoiceTable } from "@/components/Charts";
import { RehearsePanel } from "@/components/Controls";
import { ApproveContext } from "@/components/BlockRenderer";
import { Clock, HandledList, Logo, MonthlyTable, Panel, ProfileCard, QuickAnswers, RecurringTable, type TabDef, TabBar, Ticker, UpcomingTable, Watchlist } from "@/components/Terminal";

type Tab = "ask" | "answers" | "forecast" | "plan" | "bills" | "spend" | "profile";

export default function Index() {
  const { theme, toggle } = useTheme();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [stats, setStats] = useState<Record<string, { risk: number; bal: number }>>({});
  const [pid, setPid] = useState("amara");
  const [tab, setTab] = useState<Tab>("ask");
  const [baseline, setBaseline] = useState<Forecast | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
  const [approvalsBy, setApprovalsBy] = useState<Record<string, Approval[]>>({});
  const [explore, setExplore] = useState<{ label: string; adjustments: Adjustment[] } | null>(null);
  const [scenario, setScenario] = useState<SimulateResponse | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [travel, setTravel] = useState(0);
  const [voiceOn, setVoiceOn] = useState(false);
  const [brain, setBrain] = useState<Brain>("coach");
  const reqId = useRef(0);

  const messages = threads[pid] ?? [];
  const approvals = approvalsBy[pid] ?? [];
  const current = profiles.find((p) => p.profile_id === pid);
  const mode = current?.mode ?? baseline?.mode ?? "personal";
  const say = useCallback((id: string, ...m: ChatMessage[]) => setThreads((t) => ({ ...t, [id]: [...(t[id] ?? []), ...m] })), []);

  useEffect(() => {
    detectBrain().then(setBrain);
    getProfiles().then((ps) => {
      setProfiles(ps);
      ps.forEach((p, i) => setTimeout(() => getForecast(p.profile_id)
        .then((f) => setStats((r) => ({ ...r, [p.profile_id]: { risk: f.risk_summary.peak_p_negative, bal: f.balance_now } }))).catch(() => undefined), i * 150));
    }).catch(() => setError("Couldn't load the accounts. Check VITE_ENGINE_URL and that the engine is running."));
  }, []);

  useEffect(() => {
    let live = true;
    setBaseline(null); setSummary(null); setScenario(null); setExplore(null); setError(null);
    Promise.all([getForecast(pid), getSummary(pid)]).then(([f, s]) => {
      if (!live) return;
      setBaseline(f); setSummary(s);
      const a = f.alerts[0];
      setTravel(a ? Math.max(0, f.bands.findIndex((b) => b.date >= a.peak_date)) : 13);
      setThreads((t) => (t[pid]?.length ? t : { ...t, [pid]: [briefing(f, s)] }));
    }).catch(() => live && setError("Couldn't load this account's forecast. Is the engine still running?"));
    return () => { live = false; };
  }, [pid]);

  const plan = useMemo(() => approvals.map((a) => a.adjustment), [approvals]);
  const adjustments = useMemo(() => [...plan, ...(explore?.adjustments ?? [])], [plan, explore]);
  useEffect(() => {
    if (!baseline) return;
    if (!adjustments.length) { setScenario(null); return; }
    const id = ++reqId.current;
    setSimBusy(true);
    const t = setTimeout(() => {
      simulate(pid, adjustments)
        .then((r) => { if (id === reqId.current) setScenario(r); })
        .catch(() => setError("The forecast didn't update. Is the engine still running?"))
        .finally(() => { if (id === reqId.current) setSimBusy(false); });
    }, 200);
    return () => clearTimeout(t);
  }, [adjustments, baseline, pid]);

  const send = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg || busy) return;
    setTab("ask");
    const history = threads[pid] ?? [];
    say(pid, { role: "user", content: msg });
    setBusy(true); setError(null);
    try {
      const res = await chat({ profile_id: pid, mode, message: msg, history, voice: voiceOn });
      say(pid, { role: "assistant", content: res.reply, blocks: res.blocks, notes: res.data_notes,
        audio: res.audio_base64 ? { b64: res.audio_base64, mime: res.audio_mime } : undefined });
      if (res.adjustments?.length) setExplore({ label: msg, adjustments: res.adjustments });
      if (voiceOn) playAudio(res.audio_base64, res.audio_mime);
    } catch {
      setError("Couldn't answer that just now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }, [busy, mode, pid, say, threads, voiceOn]);

  const approve = useCallback(async (adj: Adjustment, label: string) => {
    if (!baseline || !summary || working) return;
    setWorking(label);
    setTab("ask");   // the follow-ups (drafted letters etc.) arrive in the conversation
    say(pid, { role: "user", content: `Yes, go ahead: ${plain(label)}.` });
    try {
      const sim = await simulate(pid, [...plan, adj]);
      const { message, approval } = onApprove(adj, label, baseline, summary, sim);
      setApprovalsBy((m) => ({ ...m, [pid]: [...(m[pid] ?? []), approval] }));
      setExplore(null);
      say(pid, message);
    } catch {
      setError("That fix didn't go through. Is the engine still running?");
    } finally {
      setWorking(null);
    }
  }, [baseline, pid, plan, say, summary, working]);

  const undo = useCallback((id: string) => {
    const a = approvals.find((x) => x.id === id);
    setApprovalsBy((m) => ({ ...m, [pid]: (m[pid] ?? []).filter((x) => x.id !== id) }));
    if (a) say(pid, { role: "assistant", content: `Undone. I've taken this out of your plan: **${plain(a.label)}**. I've stopped tracking its follow-ups too.` });
  }, [approvals, pid, say]);

  const shown = scenario?.scenario ?? baseline;
  const needs = approvals.flatMap((a) => a.tasks).filter((t) => t.status === "needs_you").length;
  const tabs: TabDef[] = [
    { id: "ask", label: "ASK", key: "1" },
    { id: "answers", label: "ANSWERS", key: "2" },
    { id: "forecast", label: "FORECAST", key: "3", badge: shown?.alerts.length || undefined },
    { id: "plan", label: "PLAN", key: "4", badge: needs || undefined },
    { id: "bills", label: mode === "business" ? "BILLS & INVOICES" : "BILLS", key: "5" },
    { id: "spend", label: "SPENDING", key: "6" },
    { id: "profile", label: "PROFILE", key: "7" },
  ];

  // Alt+1..7 switches tabs, like function keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const t = tabs.find((x) => x.key === e.key || e.code === `Digit${x.key}`);
      if (t) { e.preventDefault(); setTab(t.id as Tab); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const ctx = useMemo(() => ({ approve, approved: approvals.map((a) => a.label), working }), [approve, approvals, working]);
  const exploring = explore && (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--fs-line)] bg-[var(--fs-amber-soft)] px-3 py-2 text-sm">
      <span className="fs-label !text-[var(--fs-amber)]">Exploring</span>
      <span className="min-w-0 flex-1">{explore.label}</span>
      <button onClick={() => setExplore(null)} className="fs-mono min-h-[32px] px-2 text-xs font-semibold underline">BACK TO MY PLAN</button>
    </div>
  );

  return (
    <ApproveContext.Provider value={ctx}>
      <div className="fs-app flex h-[100dvh] flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-[var(--fs-line)] bg-[var(--fs-mist)] px-3 py-2">
          <Logo />
          <span className="fs-mono hidden text-xs text-[var(--fs-ink-2)] md:inline">YOUR AI ACCOUNTANT</span>
          <div className="ml-auto flex items-center gap-3">
            <label htmlFor="fs-acc" className="sr-only">Account</label>
            <select id="fs-acc" value={pid} onChange={(e) => setPid(e.target.value)}
              className="fs-mono h-9 max-w-[180px] border border-[var(--fs-line)] px-2 text-[13px] font-semibold uppercase text-[var(--fs-violet)] lg:hidden">
              {profiles.map((p) => <option key={p.profile_id} value={p.profile_id}>{p.name}</option>)}
            </select>
            {summary && (
              <span className="fs-mono hidden text-[13px] lg:inline">
                <span className="font-bold uppercase text-[var(--fs-violet)]">{summary.name}</span>
                <span className="ml-2 text-[var(--fs-ink-2)]">{summary.mode === "business" ? "BUSINESS" : "PERSONAL"}</span>
              </span>
            )}
            <Clock />
          </div>
        </header>
        {shown && baseline && <Ticker f={shown} base={baseline} />}
        <TabBar tabs={tabs} active={tab} onChange={(id) => setTab(id as Tab)} />

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-[250px] flex-none border-r border-[var(--fs-line)] lg:block xl:w-[300px]">
            <Watchlist profiles={profiles} stats={{ ...stats, ...(shown ? { [pid]: { risk: shown.risk_summary.peak_p_negative, bal: shown.balance_now } } : {}) }}
              pid={pid} onPick={setPid} brain={brain} theme={theme} onTheme={toggle} />
          </aside>

          <main id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
            {!baseline || !summary || !shown ? (
              <div className="fs-mono flex flex-1 items-center justify-center p-6 text-sm text-[var(--fs-ink-2)]" role="status">
                {error ?? <>LOADING · SIMULATING 1,000 FUTURES<span className="fs-blink">_</span></>}
              </div>
            ) : tab === "ask" ? (
              <div className="flex min-h-0 flex-1 gap-px bg-[var(--fs-line)]">
                <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--fs-mist)]">
                  <div className="fs-panel-h"><h2 className="fs-label">Ask your accountant</h2><span className="fs-mono text-[10px] text-[var(--fs-ink-2)]">ENTER TO SEND</span></div>
                  {exploring}
                  <Conversation messages={messages} busy={busy} profileId={pid} error={error}
                    suggestions={SUGGESTIONS[mode]} placeholder={mode === "business" ? "Ask about cash, invoices, tax…" : "Ask anything about your money"}
                    voiceOn={voiceOn} onToggleVoice={() => setVoiceOn((v) => !v)} onSend={send} />
                </section>
                <div className="hidden w-[400px] flex-none xl:flex">
                  <QuickAnswers pid={pid} f={baseline} s={summary} plan={plan} onAsk={send} />
                </div>
              </div>
            ) : (
              <div className="fs-scroll min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
                {tab === "answers" && (
                  <div className="mx-auto max-w-[900px]"><QuickAnswers pid={pid} f={baseline} s={summary} plan={plan} onAsk={send} /></div>
                )}

                {tab === "forecast" && (
                  <div className="grid gap-2 sm:gap-3 2xl:grid-cols-[1fr_420px]">
                    <Panel title="90-day forecast" right={<span className="fs-mono text-[10px] text-[var(--fs-ink-2)]">P10–P90 · 1,000 FUTURES</span>}>
                      {exploring}
                      <div className="fs-busy p-3" style={{ opacity: simBusy ? 0.5 : 1 }}>
                        <ForecastChart history={shown.history} bands={shown.bands} alerts={shown.alerts} height={340}
                          baseline={scenario ? baseline.bands : null} cursorDate={shown.bands[travel]?.date} />
                        <p className="fs-mono mt-1 text-[11px] text-[var(--fs-ink-2)]">LINE: MOST LIKELY · SHADING: 8 IN 10 FUTURES · GREEN ABOVE £0, RED BELOW{scenario && " · DASHED: BEFORE CHANGES"}</p>
                        <TimeTravel bands={shown.bands} index={travel} onChange={setTravel} />
                      </div>
                    </Panel>
                    <Panel title={`Alerts (${shown.alerts.length})`}>
                      <div className="flex flex-col gap-2 p-2">
                        {scenario?.focus_alert && <ScenarioDelta focus={scenario.focus_alert} />}
                        {shown.alerts.length ? shown.alerts.map((a) => <AlertCard key={a.id} alert={a} onApply={approve} approved={ctx.approved} applying={working} />)
                          : <p className="p-2 text-sm text-[var(--fs-ink-2)]">No cash crunches in the next 90 days.</p>}
                      </div>
                    </Panel>
                  </div>
                )}

                {tab === "plan" && (
                  <div className="grid gap-2 sm:gap-3 xl:grid-cols-[1fr_380px]">
                    <Panel title="Fixes to approve">
                      <div className="flex flex-col gap-2 p-2">
                        {baseline.alerts.length ? baseline.alerts.map((a) => <AlertCard key={a.id} alert={a} onApply={approve} approved={ctx.approved} applying={working} />)
                          : <p className="p-2 text-sm text-[var(--fs-ink-2)]">Nothing needs fixing right now. I'll flag it here the moment that changes.</p>}
                      </div>
                    </Panel>
                    <div className="flex flex-col gap-2 sm:gap-3">
                      <Panel title="Handled for you" right={needs ? <span className="fs-mono bg-[var(--fs-amber-soft)] px-1.5 text-[10px] font-semibold text-[var(--fs-amber)]">{needs} NEED YOU</span> : undefined}>
                        <HandledList approvals={approvals} onUndo={undo} />
                      </Panel>
                      <RehearsePanel mode={mode} />
                    </div>
                  </div>
                )}

                {tab === "bills" && (
                  <div className="grid gap-2 sm:gap-3 xl:grid-cols-2">
                    <Panel title="Next 30 days"><UpcomingTable f={shown} /></Panel>
                    <Panel title={`Regular payments (${summary.recurring.length})`}><RecurringTable s={summary} /></Panel>
                    {mode === "business" && summary.invoices.length > 0 && (
                      <Panel title="Invoices" className="xl:col-span-2"><InvoiceTable items={summary.invoices} profileId={pid} /></Panel>
                    )}
                  </div>
                )}

                {tab === "spend" && (
                  <div className="grid gap-2 sm:gap-3 xl:grid-cols-2">
                    <Panel title="Where money went · last 90 days"><div className="p-2"><CategoryChart data={summary.categories_90d} /></div></Panel>
                    <Panel title="In and out by month"><div className="p-2"><CashflowChart data={summary.monthly} /></div><MonthlyTable s={summary} /></Panel>
                  </div>
                )}

                {tab === "profile" && (
                  <div className="mx-auto max-w-[1000px]"><Panel title="Profile"><ProfileCard p={current} s={summary} f={shown} /></Panel></div>
                )}
              </div>
            )}
          </main>
        </div>

        <footer className="fs-mono flex items-center gap-3 border-t border-[var(--fs-line)] bg-[var(--fs-paper)] px-3 py-1 text-[11px] text-[var(--fs-ink-2)]">
          <span className="lg:hidden">
            <button onClick={toggle} className="min-h-[28px] whitespace-nowrap underline">{theme === "dark" ? "PAPER MODE" : "TERMINAL MODE"}</button>
          </span>
          <span className="truncate">{USING_MOCKS ? "DEMO DATA" : "LIVE ENGINE"}<span className="hidden md:inline">{USING_MOCKS ? " · SET VITE_ENGINE_URL TO GO LIVE" : ""} · GUIDANCE ONLY, NOT REGULATED ADVICE · YOU APPROVE EVERY ACTION</span></span>
          <span className="ml-auto hidden whitespace-nowrap sm:inline">ALT+1–7 SWITCH TABS</span>
        </footer>
      </div>
    </ApproveContext.Provider>
  );
}
