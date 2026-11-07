// The hero visual: actual balance (past) flowing into a fan of simulated futures.
import { useId } from "react";
import { Area, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Alert, Band, HistoryPoint } from "@/lib/types";
import { gbp, inTen, shortDate } from "@/lib/format";

interface Props {
  history: HistoryPoint[];
  bands: Band[];
  alerts?: Alert[];
  baseline?: Band[] | null;   // pass the pre-fix bands to show "before" as a dashed line
  height?: number;
  cursorDate?: string;        // time-travel marker
}

export default function ForecastChart({ history, bands, alerts = [], baseline, height = 300, cursorDate }: Props) {
  const base = new Map((baseline ?? []).map((b) => [b.date, b.p50]));
  const today = history.at(-1)?.date;
  const data = [
    ...history.slice(-30).map((h, i, arr) => ({
      date: h.date, actual: h.balance,
      ...(i === arr.length - 1 ? { p50: h.balance, range: [h.balance, h.balance], before: baseline ? h.balance : undefined } : {}),
    })),
    ...bands.map((b) => ({ date: b.date, p50: b.p50, range: [b.p10, b.p90], risk: b.p_negative, before: base.get(b.date) })),
  ];

  // Where £0 sits inside each series' own vertical extent -> gradient stop (green above, red below)
  const split = (vals: number[]) => {
    const v = vals.filter((x) => Number.isFinite(x));
    if (!v.length) return 1;
    const max = Math.max(...v), min = Math.min(...v);
    return max <= 0 ? 0 : min >= 0 ? 1 : max / (max - min);
  };
  const oLine = split(data.map((d: any) => d.p50));
  const oBand = split(data.flatMap((d: any) => (d.range ? d.range : [])));
  const oReal = split(data.map((d: any) => d.actual));
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`l${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={oLine} style={{ stopColor: "var(--fs-up)" }} /><stop offset={oLine} style={{ stopColor: "var(--fs-down)" }} />
            </linearGradient>
            <linearGradient id={`b${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={oBand} style={{ stopColor: "var(--fs-up)", stopOpacity: 0.18 }} /><stop offset={oBand} style={{ stopColor: "var(--fs-down)", stopOpacity: 0.22 }} />
            </linearGradient>
            <linearGradient id={`r${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={oReal} style={{ stopColor: "var(--fs-ink)" }} /><stop offset={oReal} style={{ stopColor: "var(--fs-down)" }} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={40} tick={{ fontSize: 12, fill: "var(--fs-ink-2)" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => gbp(v)} width={72} tick={{ fontSize: 12, fill: "var(--fs-ink-2)" }} axisLine={false} tickLine={false} />
          {alerts.map((a) => (
            <ReferenceArea key={a.id} x1={a.start} x2={a.end} fill="var(--fs-risk)" fillOpacity={0.08} strokeOpacity={0} />
          ))}
          <ReferenceLine y={0} stroke="var(--fs-risk)" strokeDasharray="4 4" />
          {today && <ReferenceLine x={today} stroke="var(--fs-ink-2)" strokeOpacity={0.4} label={{ value: "Today", position: "insideTopLeft", fontSize: 12, fill: "var(--fs-ink-2)" }} />}
          {cursorDate && <ReferenceLine x={cursorDate} stroke="var(--fs-violet)" strokeWidth={1.5} />}
          <Area dataKey="range" stroke="none" fill={`url(#b${id})`} fillOpacity={1} isAnimationActive animationDuration={450} />
          {baseline && <Line dataKey="before" stroke="var(--fs-ink-2)" strokeDasharray="5 5" dot={false} strokeWidth={1.5} />}
          <Line dataKey="p50" stroke={`url(#l${id})`} strokeWidth={2.5} dot={false} isAnimationActive animationDuration={450} />
          <Line dataKey="actual" stroke={`url(#r${id})`} strokeWidth={2} dot={false} />
          <Tooltip content={<ChartTip />} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="fs-surface px-3 py-2 text-sm shadow-sm">
      <div className="font-medium">{shortDate(d.date)}</div>
      {d.actual != null && d.risk == null && <div>Balance {gbp(d.actual)}</div>}
      {d.risk != null && (
        <>
          <div>Most likely {gbp(d.p50)}</div>
          <div className="text-[var(--fs-ink-2)]">Range {gbp(d.range[0])} to {gbp(d.range[1])}</div>
          {d.risk > 0.05 && <div className="text-[var(--fs-risk)]">Below £0 in {inTen(d.risk)} futures</div>}
          {d.before != null && <div className="text-[var(--fs-ink-2)]">Before the change {gbp(d.before)}</div>}
        </>
      )}
    </div>
  );
}
