// Terminal building blocks: panels, tabs, ticker, watchlist, profile, quick answers, ledgers.
import { useEffect, useState, type ReactNode } from "react";
import { Check, CircleDot, Moon, RotateCcw, Sun } from "lucide-react";
import type { Adjustment, Approval, Forecast, ProfileSummary, Summary } from "@/lib/types";
import type { Brain } from "@/lib/api";
import { gbp, inTen, kpiValue, shortDate } from "@/lib/format";
import { DEFAULT_SPEND, SPEND_WHEN, type QuickAnswer, type Verdict, readyAnswers, spendCheck } from "@/lib/quick";

export function Panel({ title, right, children, className = "", bodyClass = "" }: { title: string; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={"fs-surface flex min-w-0 flex-col " + className} aria-label={title}>
      <div className="fs-panel-h"><h2 className="fs-label">{title}</h2>{right}</div>
      <div className={"min-w-0 flex-1 " + bodyClass}>{children}</div>
    </section>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect width="32" height="32" fill="var(--fs-violet)" />
        <path d="M6 21h5l3-9 4 12 3-7h5" stroke="var(--fs-on-accent)" strokeWidth="2.6" strokeLinecap="square" />
      </svg>
      <span className="fs-mono text-[15px] font-bold tracking-[0.12em] text-[var(--fs-violet)]">FORESIGHT</span>
    </div>
  );
}

const BRAIN: Record<Brain, string> = { n8n: "AI+VOICE", claude: "AI CLAUDE", coach: "COACH (NO AI)" };

/** Live clock, terminal style. */
export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return <span className="fs-mono text-xs text-[var(--fs-ink-2)]" aria-hidden="true">{now.toLocaleTimeString("en-GB")} <span className="hidden sm:inline">{now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}</span></span>;
}

function Tick({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" | "warn" }) {
  const color = tone === "up" ? "var(--fs-up)" : tone === "down" ? "var(--fs-down)" : tone === "warn" ? "var(--fs-violet)" : "var(--fs-ink)";
  return (
    <div className="flex items-baseline gap-2 whitespace-nowrap border-r border-[var(--fs-line)] px-3 py-1.5">
      <span className="fs-mono text-[11px] font-semibold text-[var(--fs-ink-2)]">{k}</span>
      <span className="fs-mono text-sm font-semibold" style={{ color }}>{v}</span>
    </div>
  );
}

/** The quote line: the account's vital signs at a glance. */
export function Ticker({ f, base }: { f: Forecast; base: Forecast }) {
  const r = f.risk_summary;
  const delta = r.peak_p_negative - base.risk_summary.peak_p_negative;
  return (
    <div className="fs-scroll flex overflow-x-auto border-b border-[var(--fs-line)] bg-[var(--fs-paper)]" role="group" aria-label="Key figures">
      <Tick k="BAL" v={gbp(f.balance_now)} />
      <Tick k="RISK<£0" v={(r.peak_p_negative < 0.05 ? "SAFE" : inTen(r.peak_p_negative).toUpperCase()) + (Math.abs(delta) >= 0.05 ? (delta < 0 ? " ▼" : " ▲") : "")}
        tone={r.peak_p_negative >= 0.25 ? "down" : r.peak_p_negative >= 0.05 ? "warn" : "up"} />
      <Tick k="LOW" v={`${gbp(r.low_point_p50)} ${shortDate(r.low_point_date).toUpperCase()}`} tone={r.low_point_p50 < 0 ? "down" : undefined} />
      <Tick k={f.mode === "business" ? "RUNWAY" : "SAFE-2W"} v={kpiValue(f.hero.value, f.hero.unit).toUpperCase()} />
      <Tick k="ALERTS" v={String(f.alerts.length)} tone={f.alerts.length ? "warn" : "up"} />
      <Tick k="NEXT 30D OUT" v={gbp(Math.abs(f.upcoming.filter((u) => u.amount < 0).reduce((a, u) => a + u.amount, 0)))} tone="down" />
    </div>
  );
}

export interface TabDef { id: string; label: string; key: string; badge?: number }
export function TabBar({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" aria-label="Sections" className="fs-scroll flex overflow-x-auto border-b border-[var(--fs-line)] bg-[var(--fs-paper)]">
      {tabs.map((t) => (
        <button key={t.id} role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} aria-selected={active === t.id} onClick={() => onChange(t.id)} className="fs-tab"
          title={`Alt+${t.key}`}>
          <span className="fs-key" aria-hidden="true">{t.key}</span>{t.label}
          {t.badge ? <span className="fs-mono bg-[var(--fs-amber)] px-1 text-[10px] text-[var(--fs-mist)]">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Left rail: accounts as a watchlist. */
export function Watchlist({ profiles, stats, pid, onPick, brain, theme, onTheme }: {
  profiles: ProfileSummary[]; stats: Record<string, { risk: number; bal: number }>; pid: string; onPick: (id: string) => void;
  brain: Brain; theme: "light" | "dark"; onTheme: () => void;
}) {
  const groups: [string, ProfileSummary[]][] = [["PERSONAL", profiles.filter((p) => p.mode === "personal")], ["BUSINESS", profiles.filter((p) => p.mode === "business")]];
  return (
    <nav aria-label="Accounts" className="flex h-full flex-col bg-[var(--fs-paper)]">
      <div className="fs-panel-h"><span className="fs-label">Watchlist</span><span className="fs-mono text-[10px] text-[var(--fs-ink-2)]">RISK · BAL</span></div>
      <div className="fs-scroll flex-1 overflow-y-auto">
        {groups.map(([label, list]) => list.length > 0 && (
          <div key={label}>
            <div className="fs-mono border-b border-[var(--fs-line)] bg-[var(--fs-mist)] px-3 py-1 text-[10px] font-semibold tracking-widest text-[var(--fs-ink-2)]">{label}</div>
            <ul>
              {list.map((p) => {
                const st = stats[p.profile_id];
                const risky = st && st.risk >= 0.25;
                const on = p.profile_id === pid;
                return (
                  <li key={p.profile_id}>
                    <button onClick={() => onPick(p.profile_id)} aria-current={on ? "true" : undefined}
                      className="flex min-h-[44px] w-full items-center gap-2 border-b border-[var(--fs-line)] px-3 text-left hover:bg-[var(--fs-sunk)]"
                      style={on ? { background: "var(--fs-violet-soft)", boxShadow: "inset 3px 0 0 var(--fs-violet)" } : undefined}>
                      <span className="fs-mono min-w-0 flex-1 truncate text-[13px] font-semibold uppercase" style={on ? { color: "var(--fs-violet)" } : undefined}>{p.name}</span>
                      <span className="fs-mono w-12 text-right text-xs font-semibold" style={{ color: !st ? "var(--fs-ink-2)" : risky ? "var(--fs-down)" : "var(--fs-up)" }}>
                        {!st ? "…" : st.risk < 0.05 ? "SAFE" : `${Math.round(st.risk * 10)}/10`}
                      </span>
                      <span className="fs-mono hidden w-[76px] text-right text-xs text-[var(--fs-ink-2)] xl:inline">{st ? gbp(st.bal) : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[var(--fs-line)] px-3 py-2">
        <span className="fs-mono flex items-center gap-2 text-[11px] text-[var(--fs-ink-2)]">
          <span aria-hidden="true" className="h-2 w-2" style={{ background: brain === "coach" ? "var(--fs-violet)" : "var(--fs-up)" }} />
          {BRAIN[brain]}
        </span>
        <button onClick={onTheme} aria-label={theme === "dark" ? "Switch to paper (light) mode" : "Switch to terminal (dark) mode"}
          className="flex h-9 w-9 items-center justify-center border border-[var(--fs-line)] hover:bg-[var(--fs-sunk)]">
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </nav>
  );
}

const VERDICT: Record<Verdict, { label: string; color: string; bg: string }> = {
  yes: { label: "YES", color: "var(--fs-up)", bg: "var(--fs-safe-soft)" },
  careful: { label: "TIGHT", color: "var(--fs-violet)", bg: "var(--fs-violet-soft)" },
  no: { label: "NO", color: "var(--fs-down)", bg: "var(--fs-risk-soft)" },
  info: { label: "INFO", color: "var(--fs-amber)", bg: "var(--fs-amber-soft)" },
};

function AnswerRow({ a, onAsk }: { a: QuickAnswer; onAsk: (q: string) => void }) {
  const v = VERDICT[a.verdict];
  return (
    <li className="border-b border-[var(--fs-line)] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="fs-mono mt-0.5 w-12 flex-none py-0.5 text-center text-[10px] font-bold" style={{ color: v.color, background: v.bg }}>{v.label}</span>
        <div className="min-w-0 flex-1">
          <div className="fs-mono text-[13px] font-semibold">{a.q}</div>
          <div className="mt-0.5 text-sm"><span className="font-semibold">{a.headline}</span> <span className="text-[var(--fs-ink-2)]">{a.detail}</span></div>
          <button onClick={() => onAsk(a.q)} className="fs-mono mt-1 min-h-[28px] text-[11px] font-semibold text-[var(--fs-violet)] hover:underline">ASK IN CHAT ›</button>
        </div>
      </div>
    </li>
  );
}

/** Questions answered before you ask. The spend check is live: change the amount or the day. */
export function QuickAnswers({ pid, f, s, plan, onAsk }: { pid: string; f: Forecast; s: Summary; plan: Adjustment[]; onAsk: (q: string) => void }) {
  const biz = s.mode === "business";
  const [amount, setAmount] = useState<number>(DEFAULT_SPEND[s.mode]);
  const [when, setWhen] = useState(0);
  const [spend, setSpend] = useState<QuickAnswer | null>(null);
  const [extra, setExtra] = useState<QuickAnswer | null>(null);
  const planKey = JSON.stringify(plan);

  useEffect(() => { setAmount(DEFAULT_SPEND[s.mode]); setWhen(0); }, [pid, s.mode]);
  useEffect(() => {
    let live = true;
    const amt = Math.max(1, Math.round(amount || 0));
    const t = setTimeout(() => {
      spendCheck(pid, f, plan, amt, SPEND_WHEN[when].days, SPEND_WHEN[when].label).then((r) => live && setSpend(r)).catch(() => undefined);
    }, 300);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, f, planKey, amount, when]);
  useEffect(() => {   // a second, fixed spend question
    let live = true;
    const [amt, days, label] = biz ? [1500, 7, "next week"] : [100, 3, "this weekend"];
    spendCheck(pid, f, plan, amt, days, label).then((r) => live && setExtra({ ...r, id: "spend2" })).catch(() => undefined);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, f, planKey, biz]);

  const ready = readyAnswers(f, s);
  const v = spend ? VERDICT[spend.verdict] : null;
  return (
    <Panel title="Quick answers" right={<span className="fs-mono text-[10px] text-[var(--fs-ink-2)]">FROM 1,000 FUTURES</span>} bodyClass="fs-scroll overflow-y-auto">
      <div className="border-b border-[var(--fs-line)] p-3" style={{ background: v?.bg }}>
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); onAsk(`Can I spend ${gbp(amount)} ${SPEND_WHEN[when].label}?`); }}>
          <label htmlFor="fs-amt" className="fs-mono text-[13px] font-semibold">CAN I SPEND £</label>
          <input id="fs-amt" type="number" inputMode="numeric" min={1} step={biz ? 100 : 10} value={amount} onChange={(e) => setAmount(Number(e.target.value))}
            className="fs-mono h-9 w-24 border border-[var(--fs-line)] px-2 text-sm font-semibold text-[var(--fs-violet)]" />
          <label htmlFor="fs-when" className="sr-only">When</label>
          <select id="fs-when" value={when} onChange={(e) => setWhen(Number(e.target.value))} className="fs-mono h-9 border border-[var(--fs-line)] px-2 text-[13px]">
            {SPEND_WHEN.map((w, i) => <option key={w.label} value={i}>{w.label.toUpperCase()}</option>)}
          </select>
          <span className="fs-mono text-[13px] font-semibold">?</span>
        </form>
        <div className="mt-2 min-h-[44px]" aria-live="polite">
          {spend && v ? (
            <div className="flex items-start gap-2">
              <span className="fs-mono mt-0.5 w-12 flex-none py-0.5 text-center text-[10px] font-bold" style={{ color: v.color, background: "var(--fs-paper)" }}>{v.label}</span>
              <p className="text-sm"><span className="font-semibold">{spend.headline}</span> <span className="text-[var(--fs-ink-2)]">{spend.detail}</span></p>
            </div>
          ) : <span className="fs-mono text-xs text-[var(--fs-ink-2)]">SIMULATING<span className="fs-blink">_</span></span>}
        </div>
      </div>
      <ul>
        {extra && <AnswerRow a={extra} onAsk={onAsk} />}
        {ready.map((a) => <AnswerRow key={a.id} a={a} onAsk={onAsk} />)}
      </ul>
    </Panel>
  );
}

/** What the accountant is handling for you, with undo. */
export function HandledList({ approvals, onUndo }: { approvals: Approval[]; onUndo: (id: string) => void }) {
  if (!approvals.length) return <p className="p-3 text-sm text-[var(--fs-ink-2)]">Nothing yet. Approve a fix and I'll track every follow-up here.</p>;
  return (
    <ul>
      {approvals.map((a) => (
        <li key={a.id} className="border-b border-[var(--fs-line)] p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 text-sm font-semibold">{a.label}</div>
            <button onClick={() => onUndo(a.id)} aria-label={`Undo: ${a.label}`} title="Undo" className="flex h-8 w-8 flex-none items-center justify-center text-[var(--fs-ink-2)] hover:bg-[var(--fs-sunk)]"><RotateCcw size={15} /></button>
          </div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {a.tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-xs">
                {t.status === "done" ? <Check size={14} aria-label="Done" className="mt-0.5 flex-none text-[var(--fs-up)]" /> : <CircleDot size={14} aria-label="Needs you" className="mt-0.5 flex-none text-[var(--fs-amber)]" />}
                <span><span className="font-medium">{t.title}</span><span className="block text-[var(--fs-ink-2)]">{t.detail}</span></span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

const CADENCE: Record<string, string> = { weekly: "WEEKLY", fortnightly: "2-WEEKLY", four_weekly: "4-WEEKLY", monthly: "MONTHLY", quarterly: "QUARTERLY", semiannual: "6-MONTHLY", annual: "YEARLY" };

/** Bills ledger: the next 30 days, and every regular payment the engine detected. */
export function UpcomingTable({ f }: { f: Forecast }) {
  const rows = f.upcoming;
  return (
    <div className="overflow-x-auto">
      <table className="fs-table">
        <thead><tr><th>Date</th><th>Payee</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          {rows.map((u, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap text-[var(--fs-ink-2)]">{shortDate(u.date).toUpperCase()}</td>
              <td>{u.label}{u.uncertain && <span className="ml-2 text-[11px] text-[var(--fs-ink-2)]">DATE UNCERTAIN</span>}</td>
              <td className="whitespace-nowrap text-right font-semibold" style={{ color: u.amount < 0 ? "var(--fs-down)" : "var(--fs-up)" }}>{u.amount > 0 ? "+" : ""}{gbp(u.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecurringTable({ s }: { s: Summary }) {
  return (
    <div className="overflow-x-auto">
      <table className="fs-table">
        <thead><tr><th>Regular payment</th><th>Every</th><th>Next</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          {s.recurring.map((r) => (
            <tr key={r.stream_id}>
              <td>{r.label}</td>
              <td className="text-[var(--fs-ink-2)]">{CADENCE[r.cadence] ?? r.cadence.toUpperCase()}</td>
              <td className="whitespace-nowrap text-[var(--fs-ink-2)]">{r.next_date ? shortDate(r.next_date).toUpperCase() : "-"}</td>
              <td className="whitespace-nowrap text-right font-semibold" style={{ color: r.direction === "out" ? "var(--fs-down)" : "var(--fs-up)" }}>{r.direction === "in" ? "+" : ""}{gbp(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MonthlyTable({ s }: { s: Summary }) {
  return (
    <div className="overflow-x-auto">
      <table className="fs-table">
        <thead><tr><th>Month</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Net</th></tr></thead>
        <tbody>
          {s.monthly.slice(-6).reverse().map((m) => {
            const net = m.in - m.out;
            return (
              <tr key={m.month}>
                <td>{new Date(m.month + "-01").toLocaleDateString("en-GB", { month: "short", year: "2-digit" }).toUpperCase()}</td>
                <td className="text-right text-[var(--fs-up)]">{gbp(m.in)}</td>
                <td className="text-right text-[var(--fs-down)]">{gbp(m.out)}</td>
                <td className="text-right font-semibold" style={{ color: net < 0 ? "var(--fs-down)" : "var(--fs-up)" }}>{net >= 0 ? "+" : ""}{gbp(net)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The account as a profile: who, what kind of account, and what the engine knows about it. No job titles. */
export function ProfileCard({ p, s, f }: { p?: ProfileSummary; s: Summary; f: Forecast }) {
  const biz = s.mode === "business";
  const initials = s.name.replace(/^the\s+/i, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const months = s.monthly.slice(-4, -1);
  const avgIn = months.length ? months.reduce((a, m) => a + m.in, 0) / months.length : 0;
  const avgOut = months.length ? months.reduce((a, m) => a + m.out, 0) / months.length : 0;
  const bills = s.recurring.filter((r) => r.direction === "out");
  const incomes = s.recurring.filter((r) => r.direction === "in");
  const risk = f.risk_summary.peak_p_negative;
  const standing = risk >= 0.5 ? "STRETCHED" : risk >= 0.2 ? "TIGHT" : risk >= 0.05 ? "WATCH" : "STEADY";
  const rows: [string, string, string?][] = [
    ["Account type", biz ? "Business current account" : "Personal current account"],
    ["Customer type", biz ? "Small business" : "Individual"],
    ["Money in / month", gbp(avgIn), "var(--fs-up)"],
    ["Money out / month", gbp(avgOut), "var(--fs-down)"],
    ["Regular bills", `${bills.length} payees`],
    ["Monthly bills", `${gbp(Math.abs(bills.filter((r) => r.cadence === "monthly").reduce((a, r) => a + r.amount, 0)))} a month`, "var(--fs-down)"],
    ["Regular income", incomes.length ? incomes.map((r) => r.label).slice(0, 2).join(", ") + (incomes.length > 2 ? ` +${incomes.length - 2}` : "") : "Varies week to week"],
    ...(biz ? [["Unpaid invoices", `${s.invoices.filter((i) => i.status !== "paid").length}`] as [string, string]] : []),
    ["Transactions read", p?.transactions ? `${p.transactions.toLocaleString("en-GB")} (12 months)` : "-"],
    ["Days below £0 last year", p?.days_closed_negative != null ? String(p.days_closed_negative) : "-", p?.days_closed_negative ? "var(--fs-down)" : undefined],
    ...(s.detection_score ? [["Bill detection accuracy", `${Math.round(s.detection_score.precision * 100)}% precise · ${Math.round(s.detection_score.recall * 100)}% found`] as [string, string]] : []),
  ];
  return (
    <div className="grid gap-px bg-[var(--fs-line)] md:grid-cols-[260px_1fr]">
      <div className="flex flex-col items-start gap-3 bg-[var(--fs-paper)] p-5">
        <div className="fs-mono flex h-16 w-16 items-center justify-center bg-[var(--fs-violet)] text-2xl font-bold text-[var(--fs-on-accent)]" aria-hidden="true">{initials}</div>
        <div>
          <div className="fs-mono text-lg font-bold uppercase">{s.name}</div>
          <div className="fs-mono text-xs text-[var(--fs-ink-2)]">{biz ? "BUSINESS PROFILE" : "PERSONAL PROFILE"}</div>
        </div>
        <div className="fs-mono px-2 py-1 text-xs font-bold" style={{ color: risk >= 0.2 ? "var(--fs-down)" : "var(--fs-up)", background: risk >= 0.2 ? "var(--fs-risk-soft)" : "var(--fs-safe-soft)" }}>
          STANDING: {standing}
        </div>
        <div className="fs-mono text-xs text-[var(--fs-ink-2)]">BALANCE <span className="text-sm font-semibold text-[var(--fs-ink)]">{gbp(f.balance_now)}</span></div>
      </div>
      <dl className="grid bg-[var(--fs-paper)] sm:grid-cols-2">
        {rows.map(([k, v, c]) => (
          <div key={k} className="border-b border-[var(--fs-line)] px-4 py-3 sm:odd:border-r">
            <dt className="fs-label !text-[var(--fs-ink-2)]">{k}</dt>
            <dd className="fs-mono mt-1 text-sm font-semibold" style={c ? { color: c } : undefined}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
