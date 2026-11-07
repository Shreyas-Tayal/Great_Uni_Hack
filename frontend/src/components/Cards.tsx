import type { Action, Adjustment, Alert, FocusAlert, Kpi, Upcoming } from "@/lib/types";
import { gbp, inTen, kpiValue, shortDate } from "@/lib/format";

export function Kpis({ items }: { items: Kpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((k) => (
        <div key={k.label} className="fs-surface p-3">
          <div className="text-sm text-[var(--fs-ink-2)]">{k.label}</div>
          <div className="mt-1 text-xl font-semibold">{kpiValue(k.value, k.unit)}</div>
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

export function AlertCard({ alert, onApply, applying }: { alert: Alert; onApply?: (a: Adjustment, label: string) => void; applying?: string | null }) {
  return (
    <div className="fs-surface fs-reveal border-l-4 p-4" style={{ borderLeftColor: "var(--fs-risk)", borderRadius: "0 14px 14px 0" }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{alert.title}</div>
          <div className="text-sm text-[var(--fs-ink-2)]">Around {shortDate(alert.peak_date)}</div>
        </div>
        <div className="text-right">
          <RiskDots p={alert.p_negative} />
          <div className="mt-1 text-xs text-[var(--fs-ink-2)]">{inTen(alert.p_negative)} futures go below £0</div>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed">{alert.explanation}</p>
      {alert.actions?.length ? <Actions actions={alert.actions} onApply={onApply} applying={applying} /> : null}
    </div>
  );
}

export function Actions({ actions, onApply, applying }: { actions: Action[]; onApply?: (a: Adjustment, label: string) => void; applying?: string | null }) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={() => onApply?.(a.adjustment, a.label)}
          disabled={!onApply || applying === a.label}
          className="fs-focus flex items-center justify-between rounded-lg border border-[var(--fs-line)] bg-[var(--fs-paper)] px-3 py-2 text-left text-sm hover:border-[var(--fs-violet)] disabled:opacity-60"
        >
          <span>{a.label}</span>
          <span className="ml-3 whitespace-nowrap font-medium text-[var(--fs-safe)]">→ {inTen(a.new_p_negative)}</span>
        </button>
      ))}
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
        <span aria-hidden className="text-lg">→</span>
        <div><RiskDots p={focus.p_after} /><div className="mt-1 text-xs">After: {inTen(focus.p_after)}</div></div>
      </div>
    </div>
  );
}

export function UpcomingList({ items }: { items: Upcoming[] }) {
  return (
    <ul className="fs-surface divide-y divide-[var(--fs-line)]">
      {items.slice(0, 8).map((u, i) => (
        <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
          <span><span className="mr-3 text-[var(--fs-ink-2)]">{shortDate(u.date)}</span>{u.label}{u.uncertain && <span className="ml-2 text-xs text-[var(--fs-ink-2)]">(date uncertain)</span>}</span>
          <span className={u.amount < 0 ? "" : "text-[var(--fs-safe)]"}>{gbp(u.amount)}</span>
        </li>
      ))}
    </ul>
  );
}
