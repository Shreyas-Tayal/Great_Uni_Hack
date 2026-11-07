// Set URLs in .env.local (see .env.example). Anything left empty falls back to demo data.
import type { Adjustment, ChatMessage, ChatResponse, Forecast, Mode, ProfileSummary, SimulateResponse, Summary } from "./types";
import profilesMock from "@/mocks/profiles.json";
import { CONFIG } from "./config";
import { localAnswer } from "./localCoach";

const ENGINE = CONFIG.ENGINE_URL.replace(/\/$/, "");
const N8N = CONFIG.N8N_URL.replace(/\/$/, "");
export const USING_MOCKS = !ENGINE;

// Demo data: every src/mocks/forecast_<id>.json and summary_<id>.json is picked up automatically.
const FORECASTS = import.meta.glob("/src/mocks/forecast_*.json", { eager: true, import: "default" }) as Record<string, Forecast>;
const SUMMARIES = import.meta.glob("/src/mocks/summary_*.json", { eager: true, import: "default" }) as Record<string, Summary>;
const mockFile = <T,>(files: Record<string, T>, kind: string, pid: string): T => {
  const hit = files[`/src/mocks/${kind}_${pid}.json`];
  if (hit) return hit;
  const mode = (profilesMock as { profiles: ProfileSummary[] }).profiles.find((p) => p.profile_id === pid)?.mode;
  return files[`/src/mocks/${kind}_${mode === "business" ? "corner_cup" : "amara"}.json`]; // fallback
};
const mockForecast = (pid: string) => mockFile(FORECASTS, "forecast", pid);
const mockSummary = (pid: string) => mockFile(SUMMARIES, "summary", pid);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${url} failed with ${r.status}`);
  return r.json();
}
async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} failed with ${r.status}`);
  return r.json();
}

export async function getProfiles(): Promise<ProfileSummary[]> {
  if (USING_MOCKS) return (profilesMock as { profiles: ProfileSummary[] }).profiles;
  return (await get<{ profiles: ProfileSummary[] }>(`${ENGINE}/profiles`)).profiles;
}

export async function getSummary(pid: string): Promise<Summary> {
  if (USING_MOCKS) return mockSummary(pid);
  return get(`${ENGINE}/profiles/${pid}/summary`);
}

export async function getForecast(pid: string, adjustments: Adjustment[] = []): Promise<Forecast> {
  if (USING_MOCKS) return mockForecast(pid);
  return post(`${ENGINE}/forecast`, { profile_id: pid, days: 90, adjustments });
}

/** Baseline vs scenario. Demo mode approximates each adjustment so sliders and fixes still feel real. */
export async function simulate(pid: string, adjustments: Adjustment[]): Promise<SimulateResponse> {
  if (USING_MOCKS) {
    await sleep(250);
    const f = mockForecast(pid);
    const bands = calibrate(f, mockShift(f, adjustments), adjustments);
    const a = f.alerts[0];
    const win = a ? bands.filter((b) => b.date >= a.start && b.date <= a.end) : [];
    const shift14 = Math.min(...bands.slice(0, 14).map((b, i) => b.p50 - f.bands[i].p50));
    const firstNeg = bands.findIndex((b) => b.p50 < 0);
    const hero = f.mode === "business"
      ? { ...f.hero, value: firstNeg >= 0 ? Math.round(((firstNeg + 1) / 7) * 10) / 10 : null }
      : { ...f.hero, value: Math.max(0, Math.round((f.hero.value ?? 0) + shift14)) };
    const scenario: Forecast = {
      ...f, adjustments, bands, hero,
      alerts: f.alerts
        .map((al) => {
          const p = Math.max(0, ...bands.filter((b) => b.date >= al.start && b.date <= al.end).map((b) => b.p_negative));
          return { ...al, p_negative: p, explanation: al.explanation.replace(/In \d+ out of 10/, `In ${Math.round(p * 10)} out of 10`) };
        })
        .filter((al) => al.p_negative >= 0.15),
      risk_summary: (() => {
        const li = bands.reduce((m, b, i) => (b.p50 < bands[m].p50 ? i : m), 0);
        return { peak_p_negative: Math.max(...bands.map((b) => b.p_negative)), low_point_p50: Math.round(bands[li].p50), low_point_date: bands[li].date };
      })(),
    };
    return {
      baseline: { ...f.risk_summary, hero: f.hero }, scenario,
      focus_alert: a ? { alert_id: a.id, title: a.title, peak_date: a.peak_date, p_before: a.p_negative,
                         p_after: Math.min(...[Math.round(Math.max(0, ...win.map((b) => b.p_negative)) * 1000) / 1000,
                           ...(a.actions ?? []).filter((x) => adjustments.some((ad) => same(ad, x.adjustment))).map((x) => x.new_p_negative)]) } : null,
    };
  }
  return post(`${ENGINE}/simulate`, { profile_id: pid, days: 90, adjustments });
}

// --- demo-mode approximation of the engine (only used without ENGINE_URL)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** If an applied adjustment is a fix the engine already ranked, use the engine's own result for that alert. */
function calibrate(f: Forecast, bands: Forecast["bands"], applied: Adjustment[]) {
  const out = bands.map((b) => ({ ...b }));
  for (const al of f.alerts) {
    const hit = (al.actions ?? []).filter((x) => applied.some((a) => same(a, x.adjustment)));
    if (!hit.length) continue;
    const target = Math.min(...hit.map((x) => x.new_p_negative));
    const ratio = al.p_negative > 0 ? target / al.p_negative : 0;
    const s = Math.max(0, f.bands.findIndex((b) => b.date >= al.start) - 7);
    let e = f.bands.findIndex((b) => b.date > al.end); e = e < 0 ? out.length : Math.min(out.length, e + 7);
    for (let i = s; i < e; i++) {
      const b = out[i], want = f.bands[i].p_negative * ratio;
      if (b.p_negative <= want) continue;
      let lo = 0, hi = Math.max(1000, Math.abs(b.p10) * 3);   // lift until risk falls to the engine's figure
      for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (pBelowZero(b.p50 + m, b.p10 + m, b.p90 + m) > want) lo = m; else hi = m; }
      out[i] = { ...b, p10: b.p10 + hi, p50: b.p50 + hi, p90: b.p90 + hi, p_negative: Math.round(want * 1000) / 1000 };
    }
  }
  return out;
}
const erf = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const pBelowZero = (p50: number, p10: number, p90: number) => {
  const sd = Math.max(1, (p90 - p10) / 2.563);
  return Math.round(0.5 * (1 + erf((0 - p50) / (sd * Math.SQRT2))) * 1000) / 1000;
};
function mockShift(f: Forecast, input: Adjustment[]) {
  const adjustments = input.flatMap((a) => (a.type === "combo" ? a.items : [a]));
  const dailyIn = f.mode === "business" ? 900 : 60;
  const causes = f.alerts.flatMap((al: any) => al.causes ?? []);
  return f.bands.map((b, t) => {
    let d = 0;
    for (const a of adjustments) {
      if (a.type === "cut_spend") d += (a.weekly * (t + 1)) / 7;
      if (a.type === "income_change") d += (a.factor - 1) * dailyIn * (t + 1);
      if (a.type === "one_off" && t + 1 >= a.in_days) d += a.amount;
      if (a.type === "client_late") d -= t > 20 && t < 20 + a.extra_days ? 2600 : 0;
      if (a.type === "invoice_on_time" || a.type === "invoice_finance") d += t >= 3 ? 2600 : 0;
      if (a.type === "scale_stream") {
        const c = causes.find((x: any) => x.stream_id === a.stream_id);
        if (c) { const idx = f.bands.findIndex((x) => x.date >= c.date); if (t >= idx) d += Math.abs(c.amount) * (1 - a.factor); }
      }
      if (a.type === "shift_stream" || a.type === "remove_stream") {
        const c = causes.find((x: any) => x.stream_id === a.stream_id);
        if (c) {
          const idx = f.bands.findIndex((x) => x.date >= c.date);
          const until = a.type === "shift_stream" ? idx + a.days : f.bands.length;
          if (t >= idx && t < until) d += Math.abs(c.amount);
        }
      }
    }
    const p10 = b.p10 + d, p50 = b.p50 + d, p90 = b.p90 + d;
    return { ...b, p10, p50, p90, p_negative: b.p_negative < 0.01 && d >= 0 ? b.p_negative : pBelowZero(p50, p10, p90) };
  });
}

/** Which brain is answering: shown quietly in the header so nobody mistakes the demo coach for the AI. */
export type Brain = "n8n" | "claude" | "coach";
export async function detectBrain(): Promise<Brain> {
  if (N8N) return "n8n";
  if (!ENGINE) return "coach";
  try { return (await get<{ ai_chat?: boolean }>(`${ENGINE}/health`)).ai_chat ? "claude" : "coach"; } catch { return "coach"; }
}

/**
 * Chat routing: n8n (Claude + ElevenLabs voice) -> engine /chat (Claude) -> built-in coach.
 * Every route gets its numbers from the engine; the model only writes words and picks charts.
 */
export async function chat(req: { profile_id: string; mode: Mode; message: string; history: ChatMessage[]; voice: boolean }): Promise<ChatResponse> {
  const history = req.history.map(({ role, content }) => ({ role, content }));
  const notes: string[] = [];

  if (N8N) {
    try {
      const res = await post<ChatResponse>(`${N8N}/webhook/accountant-chat`, { ...req, history });
      if (res?.reply) return res;
    } catch { /* fall through */ }
    notes.push("The voice assistant is offline, so I answered here instead.");
  }

  if (ENGINE) {
    try {
      const res = await post<ChatResponse>(`${ENGINE}/chat`, { profile_id: req.profile_id, message: req.message, history });
      if (res?.reply) return { ...res, data_notes: notes };
    } catch { /* AI off or unreachable: use the built-in coach */ }
  }

  const local = await localAnswer(req.profile_id, req.mode, req.message);
  return { ...local, data_notes: [...notes, ...(local.data_notes ?? [])] };
}

export async function draftInvoiceChaser(profile_id: string, invoice_id: string, tone: "friendly" | "firm" = "friendly") {
  if (!N8N) {
    await sleep(500);
    return { subject: `Quick reminder: invoice ${invoice_id}`, body: "Hi there,\n\nJust a friendly nudge that this invoice is now past its due date...\n\nThanks,\nThe team" };
  }
  return post<{ subject: string; body: string }>(`${N8N}/webhook/chase-invoice`, { profile_id, invoice_id, tone });
}

export async function sendEmail(to: string, subject: string, body: string) {
  if (!N8N) return { ok: true, sent_to: to, redirected: false, demo: true };
  return post<{ ok: boolean; sent_to?: string; redirected?: boolean; demo?: boolean }>(`${N8N}/webhook/send-email`, { to, subject, body });
}

export function playAudio(base64: string | null, mime = "audio/mpeg") {
  if (!base64) return null;
  const audio = new Audio(`data:${mime};base64,${base64}`);
  audio.play().catch(() => undefined); // autoplay can be blocked until the user has interacted
  return audio;
}

export const SUGGESTIONS: Record<Mode, string[]> = {
  personal: [
    "How am I looking for the next 3 months?",
    "What if I lose my Saturday shift?",
    "What payments are due in the next 30 days?",
    "What if my boiler breaks next week?",
  ],
  business: [
    "What's my runway?",
    "What if Halden pays a month late?",
    "What payments are due this month?",
    "Which invoices should I chase?",
    "Can I afford to hire someone in January?",
  ],
};
