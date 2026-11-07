// Right panel: the live picture the conversation is changing. Approvals and what-ifs redraw it.
import { X } from "lucide-react";
import type { Forecast, SimulateResponse } from "@/lib/types";
import { gbp, inTen, kpiValue, shortDate } from "@/lib/format";
import ForecastChart from "./ForecastChart";
import TimeTravel from "./TimeTravel";
import { UpcomingList } from "./Cards";
import { RehearsePanel } from "./Controls";

interface Props {
  baseline: Forecast;
  scenario: SimulateResponse | null;
  busy: boolean;
  travel: number;
  onTravel: (i: number) => void;
  exploring: string | null;
  onStopExploring: () => void;
  onClose: () => void;
}

export default function GlancePanel({ baseline, scenario, busy, travel, onTravel, exploring, onStopExploring, onClose }: Props) {
  const shown = scenario?.scenario ?? baseline;
  const risk = shown.risk_summary.peak_p_negative;
  const risky = risk >= 0.25;
  return (
    <aside aria-label="Your money at a glance" className="fs-scroll flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h2 className="fs-display text-lg font-semibold">At a glance</h2>
        <button onClick={onClose} aria-label="Hide the forecast panel" className="fs-focus flex h-10 w-10 items-center justify-center rounded-xl hover:bg-[var(--fs-violet-soft)]"><X size={18} /></button>
      </div>

      {exploring && (
        <div className="flex items-center gap-2 rounded-xl bg-[var(--fs-amber-soft)] px-3 py-2 text-sm">
          <span className="min-w-0 flex-1"><span className="font-semibold">Exploring:</span> {exploring}</span>
          <button onClick={onStopExploring} className="fs-focus min-h-[32px] rounded-lg px-2 text-sm font-medium underline">Back to my plan</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="fs-surface p-3">
          <div className="text-xs text-[var(--fs-ink-2)]">{shown.hero.label}</div>
          <div className="fs-display mt-1 text-2xl font-semibold">{kpiValue(shown.hero.value, shown.hero.unit)}</div>
        </div>
        <div className="fs-surface p-3" style={{ background: risky ? "var(--fs-risk-soft)" : "var(--fs-safe-soft)" }}>
          <div className="text-xs text-[var(--fs-ink-2)]">Chance of going below £0</div>
          <div className="fs-display mt-1 text-2xl font-semibold" style={{ color: risky ? "var(--fs-risk)" : "var(--fs-safe)" }}>{risk < 0.05 ? "Safe" : inTen(risk)}</div>
        </div>
        <div className="fs-surface col-span-2 flex items-center justify-between p-3 text-sm">
          <span className="text-[var(--fs-ink-2)]">Lowest point</span>
          <span><span className="font-semibold" style={{ color: shown.risk_summary.low_point_p50 < 0 ? "var(--fs-down)" : "var(--fs-ink)" }}>{gbp(shown.risk_summary.low_point_p50)}</span> <span className="text-[var(--fs-ink-2)]">around {shortDate(shown.risk_summary.low_point_date)}</span></span>
        </div>
      </div>

      <section className="fs-surface p-3">
        <div className="fs-busy" style={{ opacity: busy ? 0.5 : 1 }}>
          <ForecastChart history={shown.history} bands={shown.bands} alerts={shown.alerts} height={210}
            baseline={scenario ? baseline.bands : null} cursorDate={shown.bands[travel]?.date} />
        </div>
        <p className="mt-1 text-xs text-[var(--fs-ink-2)]">Line: most likely balance. Shading: 8 in 10 futures. Green above £0, red below.{scenario && " Dashed: before your changes."}</p>
        <TimeTravel bands={shown.bands} index={travel} onChange={onTravel} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Coming up in the next 30 days</h3>
        <UpcomingList items={shown.upcoming} limit={6} />
      </section>

      <RehearsePanel mode={shown.mode} />
    </aside>
  );
}
