// Mirrors contracts/CONTRACT.md. Change both together.
export type Mode = "personal" | "business";

export interface ProfileSummary {
  profile_id: string; name: string; mode: Mode; tagline: string;
  closing_balance: number; min_balance: number;
}

export type Adjustment =
  | { type: "cut_spend"; weekly: number }
  | { type: "shift_stream"; stream_id: string; days: number }
  | { type: "remove_stream"; stream_id: string }
  | { type: "scale_stream"; stream_id: string; factor: number }
  | { type: "income_change"; factor: number }
  | { type: "one_off"; amount: number; in_days: number; label?: string }
  | { type: "invoice_on_time" }
  | { type: "invoice_finance"; advance?: number }
  | { type: "client_late"; extra_days: number };

export interface Band { date: string; p10: number; p50: number; p90: number; p_negative: number }
export interface HistoryPoint { date: string; balance: number }
export interface Kpi { label: string; value: number | null; unit: string }
export interface Action { label: string; new_p_negative: number; adjustment: Adjustment }
export interface Alert {
  id: string; title: string; start: string; end: string; peak_date: string;
  p_negative: number; explanation: string; actions?: Action[];
}
export interface Upcoming { date: string; label: string; amount: number; stream_id: string; uncertain?: boolean }
export interface Invoice {
  id: string; client: string; issued: string; due: string; amount: number;
  status: "paid" | "overdue" | "outstanding" | "projected"; days_late?: number;
}

export interface Forecast {
  profile_id: string; mode: Mode; as_of: string; balance_now: number;
  hero: Kpi & { note: string; kpis?: Kpi[] };
  history: HistoryPoint[]; bands: Band[]; alerts: Alert[]; upcoming: Upcoming[];
  adjustments: Adjustment[];
  risk_summary: { peak_p_negative: number; low_point_p50: number; low_point_date: string };
}

export interface Summary {
  profile_id: string; name: string; mode: Mode; tagline: string; balance_now: number;
  monthly: { month: string; in: number; out: number }[];
  categories_90d: { category: string; amount: number }[];
  recurring: { stream_id: string; label: string; cadence: string; direction: "in" | "out"; amount: number; next_date: string | null }[];
  invoices: Invoice[];
}

export interface FocusAlert { alert_id: string; title: string; peak_date: string; p_before: number; p_after: number }

export interface SimulateResponse {
  baseline: Forecast["risk_summary"] & { hero: Forecast["hero"] };
  focus_alert: FocusAlert | null;
  scenario: Forecast;
}

export type Block =
  | { type: "kpis"; items: Kpi[] }
  | { type: "forecast_chart"; data: { history: HistoryPoint[]; bands: Band[]; alerts: Alert[] } }
  | { type: "scenario_delta"; focus: FocusAlert }
  | { type: "alert"; alert: Alert }
  | { type: "actions"; actions: Action[] }
  | { type: "category_chart"; data: Summary["categories_90d"] }
  | { type: "cashflow_chart"; data: Summary["monthly"] }
  | { type: "upcoming"; items: Upcoming[] }
  | { type: "invoices"; items: Invoice[] };

export interface ChatMessage { role: "user" | "assistant"; content: string; blocks?: Block[] }

export interface ChatResponse {
  reply: string; speak: string; intent: string; adjustments: Adjustment[];
  blocks: Block[]; audio_base64: string | null; audio_mime: string;
}
