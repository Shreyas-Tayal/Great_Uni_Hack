import { useState } from "react";
import type { Action, Adjustment, Alert, Draft, FocusAlert, Kpi, Upcoming } from "@/lib/types";
import { gbp, inTen, kpiValue, shortDate } from "@/lib/format";

export function Kpis({ items }: { items: Kpi[] }) {
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(130px,1fr))]">
      {items.map((k) => (
        <div key={k.label} className="fs-surface p-3">
          <div className="text-sm text-[var(--fs-ink-2)]">{k.label}</div>
          <div className="fs-display mt-1 break-words text-xl font-semibold">{kpiValue(k.value, k.unit)}</div>
        </div>
      ))}
    </div>
  );
}

/** Risk shown as 10 dots: tangible for people who don't think in percentages. */
export function RiskDots({ p }: { p: number }) {
  const n = Math.round(p * 10);
  return (
    <div className="flex gap-1" aria-label={`Below zero in ${inTen(p)} simulated futures`}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: i < n ? "var(--fs-risk)" : "var(--fs-line)" }} />
      ))}
    </div>
  );
}

export function AlertCard({ alert, onApply, applying, approved }: { alert: Alert; onApply?: (a: Adjustment, label: string) => void; applying?: string | null; approved?: string[] }) {
  return (
    <div className="fs-surface fs-reveal overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" style={{ background: "var(--fs-risk-soft)" }}>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--fs-risk)]">Heads-up · around {shortDate(alert.peak_date)}</div>
          <div className="mt-0.5 font-semibold">{alert.title}</div>
        </div>
        <div className="text-right">
          <RiskDots p={alert.p_negative} />
          <div className="mt-1 text-xs text-[var(--fs-ink-2)]">{inTen(alert.p_negative)} futures go below £0</div>
        </div>
      </div>
      {alert.actions?.length ? (
        <div className="px-4 pb-4 pt-3">
          <div className="text-sm font-medium">Fixes I've tested</div>
          <Actions actions={alert.actions} onApply={onApply} applying={applying} approved={approved} />
        </div>
      ) : <p className="px-4 py-3 text-sm">{alert.explanation}</p>}
    </div>
  );
}

export function Actions({ actions, onApply, applying, approved = [] }: { actions: Action[]; onApply?: (a: Adjustment, label: string) => void; applying?: string | null; approved?: string[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {actions.map((a) => {
        const done = approved.includes(a.label);
        return (
          <li key={a.label} className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--fs-line)] bg-[var(--fs-paper)] px-3 py-2">
            <span className="min-w-0 flex-1 basis-full text-sm sm:basis-auto">{a.label}</span>
            <span className="ml-auto whitespace-nowrap text-xs font-medium text-[var(--fs-safe)] sm:ml-0">Risk → {inTen(a.new_p_negative)}</span>
            <button
              onClick={() => onApply?.(a.adjustment, a.label)}
              disabled={!onApply || done || applying === a.label}
              className="fs-focus min-h-[36px] rounded-lg px-3 text-sm font-semibold disabled:cursor-default"
              style={done ? { background: "var(--fs-safe-soft)", color: "var(--fs-safe)" } : { background: "var(--fs-violet)", color: "var(--fs-on-accent)" }}
            >
              {done ? "Approved" : applying === a.label ? "Working…" : "Approve"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A message the accountant drafted. The user edits, copies and sends it themselves. */
export function DraftCard({ draft }: { draft: Draft }) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${subject}\n\n${body}`); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };
  const mail = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <div className="fs-surface fs-reveal p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--fs-amber)]">Draft for you to send · to {draft.to}</div>
      </div>
      <label className="mt-3 block text-xs text-[var(--fs-ink-2)]" >Subject
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className="fs-focus mt-1 w-full rounded-lg border border-[var(--fs-line)] px-3 py-2 text-sm font-medium" />
      </label>
      <label className="mt-2 block text-xs text-[var(--fs-ink-2)]">Message
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} className="fs-focus mt-1 w-full rounded-lg border border-[var(--fs-line)] px-3 py-2 text-sm leading-relaxed" />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <a href={mail} className="fs-focus inline-flex min-h-[40px] items-center rounded-lg bg-[var(--fs-violet)] px-4 text-sm font-semibold text-[var(--fs-on-accent)]">Open in email</a>
        <button onClick={copy} className="fs-focus min-h-[40px] rounded-lg border border-[var(--fs-line)] px-4 text-sm font-medium">{copied ? "Copied" : "Copy text"}</button>
      </div>
    </div>
  );
}

export function ScenarioDelta({ focus }: { focus: FocusAlert }) {
  const better = focus.p_after < focus.p_before;
  return (
    <div className="fs-surface fs-reveal p-4" style={{ background: better ? "var(--fs-safe-soft)" : "var(--fs-risk-soft)" }}>
      <div className="text-sm text-[var(--fs-ink-2)]">{focus.title}, around {shortDate(focus.peak_date)}</div>
      <div className="mt-2 flex items-center gap-4">
        <div><RiskDots p={focus.p_before} /><div className="mt-1 text-xs">Before: {inTen(focus.p_before)}</div></div>
        <span aria-hidden="true" className="text-lg">→</span>
        <div><RiskDots p={focus.p_after} /><div className="mt-1 text-xs">After: {inTen(focus.p_after)}</div></div>
      </div>
    </div>
  );
}

export function UpcomingList({ items, limit = 8, totals = false }: { items: Upcoming[]; limit?: number; totals?: boolean }) {
  const [all, setAll] = useState(false);
  const out = items.filter((u) => u.amount < 0).reduce((a, u) => a + u.amount, 0);
  const inn = items.filter((u) => u.amount > 0).reduce((a, u) => a + u.amount, 0);
  const rows = all ? items : items.slice(0, limit);
  return (
    <div className="fs-surface overflow-hidden">
      {totals && (
        <div className={"grid border-b border-[var(--fs-line)] " + (inn > 0 ? "grid-cols-2" : "grid-cols-1")}>
          <div className="p-3"><div className="text-xs text-[var(--fs-ink-2)]">Going out</div><div className="text-lg font-semibold text-[var(--fs-down)]">{gbp(Math.abs(out))}</div></div>
          {inn > 0 && <div className="border-l border-[var(--fs-line)] p-3"><div className="text-xs text-[var(--fs-ink-2)]">Fixed money coming in</div><div className="text-lg font-semibold text-[var(--fs-up)]">{gbp(inn)}</div></div>}
        </div>
      )}
      <ul className="divide-y divide-[var(--fs-line)]">
        {rows.map((u, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <span className="min-w-0"><span className="mr-3 text-[var(--fs-ink-2)]">{shortDate(u.date)}</span><span className="break-words">{u.label}</span>{u.uncertain && <span className="ml-2 text-xs text-[var(--fs-ink-2)]">(date uncertain)</span>}</span>
            <span className={"whitespace-nowrap font-medium " + (u.amount < 0 ? "text-[var(--fs-down)]" : "text-[var(--fs-up)]")}>{gbp(u.amount)}</span>
          </li>
        ))}
      </ul>
      {items.length > limit && (
        <button onClick={() => setAll(!all)} className="fs-focus w-full border-t border-[var(--fs-line)] px-4 py-2 text-left text-sm text-[var(--fs-violet)] hover:bg-[var(--fs-violet-soft)]">
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}
