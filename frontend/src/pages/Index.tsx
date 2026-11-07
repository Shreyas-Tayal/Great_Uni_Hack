// Chat-first layout: the conversation is the app. Accounts and "handled for you" on the left,
// the live forecast on the right (collapsible). Approving a fix or asking a what-if redraws the forecast.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Menu } from "lucide-react";
import type { Adjustment, Approval, ChatMessage, Forecast, ProfileSummary, SimulateResponse, Summary } from "@/lib/types";
import { type Brain, SUGGESTIONS, USING_MOCKS, chat, detectBrain, getForecast, getProfiles, getSummary, playAudio, simulate } from "@/lib/api";
import { briefing, onApprove, plain } from "@/lib/plan";
import { gbp, inTen } from "@/lib/format";
import { useTheme } from "@/hooks/useTheme";
import Conversation from "@/components/Conversation";
import Sidebar from "@/components/Sidebar";
import GlancePanel from "@/components/GlancePanel";
import { ApproveContext } from "@/components/BlockRenderer";

const wide = () => typeof window !== "undefined" && window.matchMedia?.("(min-width: 1280px)").matches;

export default function Index() {
  const { theme, toggle } = useTheme();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [risks, setRisks] = useState<Record<string, number>>({});
  const [pid, setPid] = useState("amara");
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
  const [panelOpen, setPanelOpen] = useState<boolean>(wide);
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [brain, setBrain] = useState<Brain>("coach");
  const reqId = useRef(0);

  const messages = threads[pid] ?? [];
  const approvals = approvalsBy[pid] ?? [];
  const current = profiles.find((p) => p.profile_id === pid);
  const mode = current?.mode ?? baseline?.mode ?? "personal";
  const say = useCallback((id: string, ...m: ChatMessage[]) => setThreads((t) => ({ ...t, [id]: [...(t[id] ?? []), ...m] })), []);

  // Accounts, which brain is answering, and each account's headline risk for the sidebar
  useEffect(() => {
    detectBrain().then(setBrain);
    getProfiles().then((ps) => {
      setProfiles(ps);
      ps.forEach((p, i) => setTimeout(() => getForecast(p.profile_id)
        .then((f) => setRisks((r) => ({ ...r, [p.profile_id]: f.risk_summary.peak_p_negative }))).catch(() => undefined), i * 150));
    }).catch(() => setError("I couldn't load the accounts. Check VITE_ENGINE_URL and that the engine is running."));
  }, []);

  // Load an account; the first time, the accountant opens with a briefing
  useEffect(() => {
    let live = true;
    setBaseline(null); setSummary(null); setScenario(null); setExplore(null); setError(null);
    Promise.all([getForecast(pid), getSummary(pid)]).then(([f, s]) => {
      if (!live) return;
      setBaseline(f); setSummary(s);
      const a = f.alerts[0];
      setTravel(a ? Math.max(0, f.bands.findIndex((b) => b.date >= a.peak_date)) : 13);
      setThreads((t) => (t[pid]?.length ? t : { ...t, [pid]: [briefing(f, s)] }));
    }).catch(() => live && setError("I couldn't load this account's forecast. Is the engine still running?"));
    return () => { live = false; };
  }, [pid]);

  // Approved fixes plus any what-if being explored become one scenario
  const adjustments = useMemo(() => [...approvals.map((a) => a.adjustment), ...(explore?.adjustments ?? [])], [approvals, explore]);
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
    const history = threads[pid] ?? [];
    say(pid, { role: "user", content: msg });
    setBusy(true); setError(null);
    try {
      const res = await chat({ profile_id: pid, mode, message: msg, history, voice: voiceOn });
      say(pid, { role: "assistant", content: res.reply, blocks: res.blocks, notes: res.data_notes,
        audio: res.audio_base64 ? { b64: res.audio_base64, mime: res.audio_mime } : undefined });
      if (res.adjustments?.length) { setExplore({ label: msg, adjustments: res.adjustments }); if (wide()) setPanelOpen(true); }
      if (voiceOn) playAudio(res.audio_base64, res.audio_mime);
    } catch {
      setError("I couldn't answer that just now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }, [busy, mode, pid, say, threads, voiceOn]);

  const approve = useCallback(async (adj: Adjustment, label: string) => {
    if (!baseline || !summary || working) return;
    setWorking(label);
    say(pid, { role: "user", content: `Yes, go ahead: ${plain(label)}.` });
    try {
      const sim = await simulate(pid, [...approvals.map((a) => a.adjustment), adj]);
      const { message, approval } = onApprove(adj, label, baseline, summary, sim);
      setApprovalsBy((m) => ({ ...m, [pid]: [...(m[pid] ?? []), approval] }));
      setExplore(null);
      say(pid, message);
    } catch {
      setError("That fix didn't go through. Is the engine still running?");
    } finally {
      setWorking(null);
    }
  }, [approvals, baseline, pid, say, summary, working]);

  const undo = useCallback((id: string) => {
    const a = approvals.find((x) => x.id === id);
    setApprovalsBy((m) => ({ ...m, [pid]: (m[pid] ?? []).filter((x) => x.id !== id) }));
    if (a) say(pid, { role: "assistant", content: `Undone. I've taken this out of your plan: **${plain(a.label)}**. I've stopped tracking its follow-ups too.` });
  }, [approvals, pid, say]);

  const pick = (id: string) => { setPid(id); setMenuOpen(false); };
  const shown = scenario?.scenario ?? baseline;
  const risk = shown?.risk_summary.peak_p_negative ?? 0;
  const ctx = useMemo(() => ({ approve, approved: approvals.map((a) => a.label), working }), [approve, approvals, working]);

  const sidebar = (onClose?: () => void) => (
    <Sidebar profiles={profiles} risks={{ ...risks, ...(baseline ? { [pid]: risk } : {}) }} pid={pid} onPick={pick}
      approvals={approvals} onUndo={undo} theme={theme} onTheme={toggle} brain={brain} onClose={onClose} />
  );

  return (
    <ApproveContext.Provider value={ctx}>
      <div className="fs-app flex h-[100dvh] overflow-hidden">
        <div className="hidden w-[280px] flex-none border-r border-[var(--fs-line)] lg:block">{sidebar()}</div>
        {menuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
            <div className="fs-drawer absolute inset-y-0 left-0 w-[86%] max-w-[320px] shadow-xl">{sidebar(() => setMenuOpen(false))}</div>
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center gap-3 border-b border-[var(--fs-line)] px-4 py-3 sm:px-6">
            <button onClick={() => setMenuOpen(true)} aria-label="Open accounts and tasks" className="fs-focus -ml-2 flex h-10 w-10 items-center justify-center rounded-xl hover:bg-[var(--fs-violet-soft)] lg:hidden"><Menu size={20} /></button>
            <div className="min-w-0 flex-1">
              <h1 className="fs-display truncate text-lg font-semibold leading-tight">{summary?.name ?? current?.name ?? "Loading…"}</h1>
              <p className="truncate text-sm text-[var(--fs-ink-2)]">{summary?.tagline ?? current?.tagline ?? ""}</p>
            </div>
            {shown && (
              <div className="flex items-center gap-2">
                <span className="hidden rounded-full bg-[var(--fs-paper)] px-3 py-1.5 text-sm ring-1 ring-[var(--fs-line)] sm:inline">
                  <span className="text-[var(--fs-ink-2)]">Today </span><span className="font-semibold">{gbp(shown.balance_now)}</span>
                </span>
                <span className="rounded-full px-3 py-1.5 text-sm font-semibold"
                  style={risk >= 0.25 ? { background: "var(--fs-risk-soft)", color: "var(--fs-risk)" } : { background: "var(--fs-safe-soft)", color: "var(--fs-safe)" }}>
                  {risk < 0.05 ? "Safe for 90 days" : `${inTen(risk)} risk`}
                </span>
                <button onClick={() => setPanelOpen((o) => !o)} aria-pressed={panelOpen} aria-label={panelOpen ? "Hide the forecast" : "Show the forecast"}
                  className="fs-focus flex h-10 items-center gap-2 rounded-xl border border-[var(--fs-line)] bg-[var(--fs-paper)] px-3 text-sm font-medium">
                  <LineChart size={18} /><span className="hidden sm:inline">Forecast</span>
                </button>
              </div>
            )}
          </header>
          {USING_MOCKS && (
            <div className="border-b border-[var(--fs-line)] bg-[var(--fs-amber-soft)] px-4 py-1.5 text-center text-xs text-[var(--fs-amber)] sm:px-6">
              Demo mode: forecasts come from saved engine output. Set VITE_ENGINE_URL to go live.
            </div>
          )}
          {baseline ? (
            <Conversation messages={messages} busy={busy} profileId={pid} error={error}
              suggestions={SUGGESTIONS[mode]} placeholder={mode === "business" ? "Ask about cash, invoices, tax…" : "Ask anything about your money"}
              voiceOn={voiceOn} onToggleVoice={() => setVoiceOn((v) => !v)} onSend={send} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--fs-ink-2)]" role="status">
              {error ?? "Reading the last few months and simulating the next 90 days…"}
            </div>
          )}
        </main>

        {panelOpen && baseline && (
          <>
            <button aria-label="Hide the forecast" className="fixed inset-0 z-30 bg-black/40 xl:hidden" onClick={() => setPanelOpen(false)} />
            <div className="fs-drawer fixed inset-y-0 right-0 z-40 w-full max-w-[420px] border-l border-[var(--fs-line)] bg-[var(--fs-mist)] xl:static xl:z-auto xl:w-[400px] xl:flex-none">
              <GlancePanel baseline={baseline} scenario={scenario} busy={simBusy} travel={travel} onTravel={setTravel}
                exploring={explore?.label ?? null} onStopExploring={() => setExplore(null)} onClose={() => setPanelOpen(false)} />
            </div>
          </>
        )}
      </div>
    </ApproveContext.Provider>
  );
}
