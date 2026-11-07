// Layout: conversation on the left (AI-first), live forecast canvas on the right.
// Any what-if (from a button or from the AI) updates the canvas, with the old forecast dashed underneath.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Adjustment, Band, Forecast, Mode, ProfileSummary, SimulateResponse } from "@/lib/types";
import { USING_MOCKS, getForecast, getProfiles, simulate } from "@/lib/api";
import { gbp, kpiValue } from "@/lib/format";
import ForecastChart from "@/components/ForecastChart";
import ChatPanel from "@/components/ChatPanel";
import { AlertCard, ScenarioDelta, UpcomingList } from "@/components/Cards";
import { ModeToggle, ProfilePicker, RehearsePanel } from "@/components/Controls";
import "@/foresight.css";

export default function Index() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [mode, setMode] = useState<Mode>("personal");
  const [pid, setPid] = useState("amara");
  const [baseline, setBaseline] = useState<Forecast | null>(null);
  const [scenario, setScenario] = useState<SimulateResponse | null>(null);
  const [scenarioLabel, setScenarioLabel] = useState("");
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getProfiles().then(setProfiles).catch(() => setError("Couldn't load accounts. Is the engine running?")); }, []);
  useEffect(() => {
    setBaseline(null); setScenario(null);
    getForecast(pid).then(setBaseline).catch(() => setError("Couldn't load the forecast. Check VITE_ENGINE_URL."));
  }, [pid]);

  const inMode = useMemo(() => profiles.filter((p) => p.mode === mode), [profiles, mode]);
  const current = profiles.find((p) => p.profile_id === pid);

  const switchMode = (m: Mode) => {
    setMode(m);
    const first = profiles.find((p) => p.mode === m);
    if (first) setPid(first.profile_id);
  };

  const applyScenario = useCallback(async (adjustments: Adjustment[], label: string) => {
    setApplying(label);
    try {
      const prev = scenario?.scenario.adjustments ?? [];
      setScenario(await simulate(pid, [...prev, ...adjustments]));
      setScenarioLabel(label);
    } finally {
      setApplying(null);
    }
  }, [pid, scenario]);

  const shown = scenario?.scenario ?? baseline;
  const beforeBands: Band[] | null = scenario && baseline ? baseline.bands : null;

  return (
    <div className="fs-app min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-baseline gap-3">
          <span className="text-xl font-semibold tracking-tight">Foresight</span>
          <span className="hidden text-sm text-[var(--fs-ink-2)] sm:inline">See your money 90 days early</span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <ModeToggle mode={mode} onChange={switchMode} />
          <ProfilePicker profiles={inMode} value={pid} onChange={setPid} />
        </div>
      </header>
      {USING_MOCKS && <div className="mx-6 mb-2 rounded-md bg-[var(--fs-violet-soft)] px-3 py-1.5 text-xs">Demo data mode: set VITE_ENGINE_URL and VITE_N8N_URL to go live.</div>}
      {error && <div role="alert" className="mx-6 mb-2 text-sm text-[var(--fs-risk)]">{error}</div>}

      <main className="grid gap-4 px-6 pb-6 lg:grid-cols-[minmax(340px,5fr)_7fr]">
        <div className="fs-surface lg:sticky lg:top-4 lg:h-[calc(100vh-110px)]">
          <ChatPanel profileId={pid} mode={mode} name={current?.name ?? ""} onScenario={applyScenario} />
        </div>

        <div className="space-y-4">
          {shown ? (
            <>
              <section className="fs-surface p-5">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="text-sm text-[var(--fs-ink-2)]">{shown.hero.label}</div>
                    <div className="text-4xl font-semibold tracking-tight">{kpiValue(shown.hero.value, shown.hero.unit)}</div>
                    <div className="text-sm text-[var(--fs-ink-2)]">{shown.hero.note}</div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="text-[var(--fs-ink-2)]">In the bank today</div>
                    <div className="text-lg font-medium">{gbp(shown.balance_now)}</div>
                  </div>
                </div>
                <div className="mt-4">
                  <ForecastChart history={shown.history} bands={shown.bands} alerts={shown.alerts} baseline={beforeBands} />
                </div>
                <p className="mt-2 text-xs text-[var(--fs-ink-2)]">
                  Solid line: your real balance. Purple: the most likely path, with the shaded range covering 8 in 10 simulated futures.
                  {beforeBands && " Dashed: before your change."}
                </p>
              </section>

              {scenario && (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm">Trying: <span className="font-medium">{scenarioLabel}</span></span>
                  <button className="fs-focus text-sm text-[var(--fs-violet)] hover:underline" onClick={() => setScenario(null)}>Back to today's plan</button>
                </div>
              )}
              {scenario?.focus_alert && <ScenarioDelta focus={scenario.focus_alert} />}

              {shown.alerts.length === 0 && (
                <div className="fs-surface p-4 text-sm">No cash crunches in the next 90 days. Ask what would happen if something changed.</div>
              )}
              {shown.alerts.map((a) => <AlertCard key={a.id} alert={a} onApply={(adj, label) => applyScenario([adj], label)} applying={applying} />)}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="mb-2 font-medium">Coming up in the next 30 days</h3>
                  <UpcomingList items={shown.upcoming} />
                </div>
                <RehearsePanel mode={mode} />
              </div>
            </>
          ) : (
            <div className="fs-surface p-6 text-sm text-[var(--fs-ink-2)]">Loading the forecast…</div>
          )}
        </div>
      </main>
    </div>
  );
}
