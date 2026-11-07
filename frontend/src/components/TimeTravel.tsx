// "Financial time travel": drag to any future day and see what your account probably looks like then.
import type { Band } from "@/lib/types";
import { gbp, inTen } from "@/lib/format";
import { RiskDots } from "./Cards";

export default function TimeTravel({ bands, index, onChange }: { bands: Band[]; index: number; onChange: (i: number) => void }) {
  const b = bands[Math.min(index, bands.length - 1)];
  if (!b) return null;
  const when = new Date(b.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long" });
  const danger = b.p_negative >= 0.2;
  return (
    <div className="mt-4 rounded-xl border border-[var(--fs-line)] p-4" style={{ background: danger ? "var(--fs-risk-soft)" : b.p_negative < 0.05 ? "var(--fs-safe-soft)" : "var(--fs-violet-soft)" }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-[var(--fs-ink-2)]">Travel to {when}</div>
          <div className="text-2xl font-semibold" style={{ color: b.p50 < 0 ? "var(--fs-down)" : "var(--fs-ink)" }}>{gbp(b.p50)} <span className="text-sm font-normal text-[var(--fs-ink-2)]">most likely</span></div>
          <div className="text-sm text-[var(--fs-ink-2)]">Somewhere between {gbp(b.p10)} and {gbp(b.p90)}</div>
        </div>
        <div className="text-right">
          <RiskDots p={b.p_negative} />
          <div className="mt-1 text-xs">{b.p_negative < 0.05 ? "Very unlikely to go below £0" : `Below £0 in ${inTen(b.p_negative)} futures`}</div>
        </div>
      </div>
      <input
        type="range" min={0} max={bands.length - 1} value={index}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Choose a future date"
        className="fs-focus mt-3 w-full accent-[var(--fs-violet)]"
      />
      <div className="flex justify-between text-xs text-[var(--fs-ink-2)]"><span>Tomorrow</span><span>In {bands.length} days</span></div>
    </div>
  );
}
