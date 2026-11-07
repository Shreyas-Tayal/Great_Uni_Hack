// OWNER: Person 2. Works fully on mocks until VITE_ENGINE_URL / VITE_N8N_URL are set.
//   VITE_ENGINE_URL=https://<engine-tunnel>         (Person 1's FastAPI)
//   VITE_N8N_URL=https://<you>.app.n8n.cloud        (Person 3's n8n)
import type { Adjustment, ChatMessage, ChatResponse, Forecast, Mode, ProfileSummary, SimulateResponse, Summary } from "./types";
import profilesMock from "@/mocks/profiles.json";
import forecastAmara from "@/mocks/forecast_amara.json";
import forecastCafe from "@/mocks/forecast_corner_cup.json";
import summaryAmara from "@/mocks/summary_amara.json";
import summaryCafe from "@/mocks/summary_corner_cup.json";
import chatAmara from "@/mocks/chat_amara.json";

const ENGINE = import.meta.env.VITE_ENGINE_URL as string | undefined;
const N8N = import.meta.env.VITE_N8N_URL as string | undefined;
export const USING_MOCKS = !ENGINE;

const isBusiness = (pid: string) => ["corner_cup", "lumen_labs"].includes(pid);
const mockForecast = (pid: string) => (isBusiness(pid) ? forecastCafe : forecastAmara) as unknown as Forecast;
const mockSummary = (pid: string) => (isBusiness(pid) ? summaryCafe : summaryAmara) as unknown as Summary;
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

/** Baseline vs scenario. In mock mode, pretends the fix lowers risk so the UI animation can be built. */
export async function simulate(pid: string, adjustments: Adjustment[]): Promise<SimulateResponse> {
  if (USING_MOCKS) {
    const f = mockForecast(pid);
    await sleep(400);
    const lift = 400;
    const scenario: Forecast = {
      ...f, adjustments,
      bands: f.bands.map((b) => ({ ...b, p10: b.p10 + lift, p50: b.p50 + lift, p90: b.p90 + lift, p_negative: b.p_negative * 0.35 })),
      alerts: f.alerts.slice(1),
    };
    const a = f.alerts[0];
    return {
      baseline: { ...f.risk_summary, hero: f.hero }, scenario,
      focus_alert: a ? { alert_id: a.id, title: a.title, peak_date: a.peak_date, p_before: a.p_negative, p_after: a.p_negative * 0.35 } : null,
    };
  }
  return post(`${ENGINE}/simulate`, { profile_id: pid, days: 90, adjustments });
}

export async function chat(req: { profile_id: string; mode: Mode; message: string; history: ChatMessage[]; voice: boolean }): Promise<ChatResponse> {
  if (!N8N) {
    await sleep(700);
    return chatAmara as unknown as ChatResponse;
  }
  const history = req.history.map(({ role, content }) => ({ role, content }));
  return post(`${N8N}/webhook/accountant-chat`, { ...req, history });
}

export async function draftInvoiceChaser(profile_id: string, invoice_id: string, tone: "friendly" | "firm" = "friendly") {
  if (!N8N) {
    await sleep(500);
    return { subject: `Quick reminder: invoice ${invoice_id}`, body: "Hi there,\n\nJust a friendly nudge that this invoice is now past its due date...\n\nThanks,\nThe team" };
  }
  return post<{ subject: string; body: string }>(`${N8N}/webhook/chase-invoice`, { profile_id, invoice_id, tone });
}

export async function sendEmail(to: string, subject: string, body: string) {
  if (!N8N) return { ok: true };
  return post<{ ok: boolean }>(`${N8N}/webhook/send-email`, { to, subject, body });
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
    "Where is my money going?",
    "What if my boiler breaks next week?",
  ],
  business: [
    "What's my runway?",
    "What if Halden pays a month late?",
    "Which invoices should I chase?",
    "Can I afford to hire someone in January?",
  ],
};
