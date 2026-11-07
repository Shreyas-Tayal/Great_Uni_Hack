// Pre-answered questions. Each answer is computed from the engine's forecast (spend checks re-run the
// simulation with the purchase added), so they're ready before you ask and never invented.
import type { Adjustment, Forecast, Summary } from "./types";
import { simulate } from "./api";
import { gbp, inTen, shortDate } from "./format";

export type Verdict = "yes" | "careful" | "no" | "info";
export interface QuickAnswer { id: string; q: string; verdict: Verdict; headline: string; detail: string }

const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const riskWord = (p: number) => (p < 0.05 ? "under 1 in 10" : inTen(p));

/** "Can I spend £X?": adds the purchase to the plan and re-simulates 1,000 futures. */
export async function spendCheck(pid: string, f: Forecast, plan: Adjustment[], amount: number, inDays: number, when: string): Promise<QuickAnswer> {
  const q = `Can I spend ${gbp(amount)} ${when}?`;
  const before = plan.length ? (await simulate(pid, plan)).scenario.risk_summary : f.risk_summary;
  const after = (await simulate(pid, [...plan, { type: "one_off", amount: -amount, in_days: Math.max(1, inDays), label: "Planned spend" }])).scenario.risk_summary;
  const rise = after.peak_p_negative - before.peak_p_negative;
  const low = `${gbp(after.low_point_p50)} around ${shortDate(after.low_point_date)}`;
  if (after.peak_p_negative < 0.05 && after.low_point_p50 >= 0) {
    return { id: "spend", q, verdict: "yes", headline: "Yes.", detail: `Your lowest point would still be ${low}, and the chance of going below £0 stays ${riskWord(after.peak_p_negative)}.` };
  }
  if (rise < 0.05 && before.peak_p_negative >= 0.25) {
    return { id: "spend", q, verdict: "careful", headline: "It barely changes things, but money's already tight.", detail: `Your risk of going below £0 stays about ${riskWord(after.peak_p_negative)}, with the lowest point ${low}. Check the PLAN tab for fixes first.` };
  }
  if (rise < 0.1 && after.peak_p_negative < 0.3) {
    return { id: "spend", q, verdict: "careful", headline: "Yes, but it's tight.", detail: `Your lowest point drops to ${low}. The chance of going below £0 goes from ${riskWord(before.peak_p_negative)} to ${riskWord(after.peak_p_negative)}.` };
  }
  return { id: "spend", q, verdict: "no", headline: "Not safely right now.", detail: `It takes your lowest point to ${low}, and the chance of going below £0 from ${riskWord(before.peak_p_negative)} to ${riskWord(after.peak_p_negative)}. Waiting until after your next money comes in is safer.` };
}

/** Questions answered straight from the forecast and the account summary. */
export function readyAnswers(f: Forecast, s: Summary): QuickAnswer[] {
  const biz = s.mode === "business";
  const out: QuickAnswer[] = [];
  const band = (iso: string) => f.bands.find((b) => b.date >= iso) ?? f.bands[f.bands.length - 1];

  if (biz) {
    out.push(f.hero.value == null
      ? { id: "runway", q: "What's my runway?", verdict: "yes", headline: "Cash is growing.", detail: "On the most likely path, cash rises over the next 90 days, so there's no runway limit in sight." }
      : { id: "runway", q: "What's my runway?", verdict: f.hero.value < 12 ? "careful" : "yes", headline: `About ${f.hero.value} weeks.`, detail: `That's at the current pace of money in and out, on the most likely of 1,000 simulated futures.` });
    const pay = s.recurring.find((r) => r.direction === "out" && /payroll|wages|salar|paye/i.test(r.label) && r.next_date);
    if (pay?.next_date) {
      const b = band(pay.next_date);
      out.push({ id: "payroll", q: "Can I make the next payroll?", verdict: b.p_negative >= 0.25 ? "no" : b.p_negative >= 0.05 ? "careful" : "yes",
        headline: b.p_negative >= 0.25 ? "It's at risk." : b.p_negative >= 0.05 ? "Probably, but it's close." : "Yes.",
        detail: `${pay.label} (${gbp(Math.abs(pay.amount))}) goes out on ${longDate(pay.next_date)}. That day the balance is most likely ${gbp(b.p50)}, with a ${riskWord(b.p_negative)} chance of being below £0.` });
    }
    const unpaid = s.invoices.filter((i) => i.status !== "paid");
    const overdue = unpaid.filter((i) => i.status === "overdue");
    out.push(unpaid.length
      ? { id: "owed", q: "Who owes me money?", verdict: overdue.length ? "careful" : "info", headline: `${gbp(unpaid.reduce((a, i) => a + i.amount, 0))} across ${unpaid.length} ${unpaid.length === 1 ? "invoice" : "invoices"}.`,
          detail: overdue.length ? `${overdue.length} overdue, the oldest from ${overdue[0].client} (${overdue[0].days_late} days late). Ask me to draft the reminder.` : `Nothing is overdue yet. Next due: ${unpaid[0].client}, ${gbp(unpaid[0].amount)} on ${shortDate(unpaid[0].due)}.` }
      : { id: "owed", q: "Who owes me money?", verdict: "info", headline: "Nobody right now.", detail: "There are no unpaid invoices." });
  } else {
    out.push({ id: "safe", q: "How much can I safely spend?", verdict: (f.hero.value ?? 0) > 0 ? "info" : "no", headline: `About ${gbp(f.hero.value)} over the next 2 weeks.`,
      detail: "That amount keeps you above £0 in 4 out of 5 simulated futures, after every bill that's due." });
    const xmas = `${new Date(f.as_of).getUTCFullYear()}-12-25`;
    if (xmas > f.as_of && xmas <= f.bands[f.bands.length - 1].date) {
      const b = band(xmas);
      out.push({ id: "xmas", q: "How will I look at Christmas?", verdict: b.p_negative >= 0.25 ? "no" : b.p_negative >= 0.05 ? "careful" : "yes",
        headline: `Most likely ${gbp(b.p50)} on Christmas Day.`, detail: `Somewhere between ${gbp(b.p10)} and ${gbp(b.p90)}, with a ${riskWord(b.p_negative)} chance of being below £0.` });
    }
  }

  const low = f.risk_summary;
  const a = f.alerts[0];
  out.push({ id: "tight", q: "When's my tightest day?", verdict: low.peak_p_negative >= 0.25 ? "no" : low.peak_p_negative >= 0.05 ? "careful" : "yes",
    headline: `${longDate(low.low_point_date)}: ${gbp(low.low_point_p50)}.`,
    detail: a ? `The first squeeze is around ${shortDate(a.peak_date)}. ${a.explanation}` : "Nothing in the next 90 days is likely to go below £0." });

  const inc = f.upcoming.find((u) => u.amount > 0 && !u.uncertain);
  if (inc) out.push({ id: "next-in", q: "When does money next come in?", verdict: "info", headline: `${longDate(inc.date)}: ${gbp(inc.amount)}.`, detail: `${inc.label}.` });

  const week = addDays(f.as_of, 7);
  const due = f.upcoming.filter((u) => u.amount < 0 && u.date <= week);
  const total = due.reduce((s2, u) => s2 + u.amount, 0);
  out.push({ id: "week", q: "What's going out this week?", verdict: "info",
    headline: due.length ? `${gbp(Math.abs(total))} across ${due.length} ${due.length === 1 ? "payment" : "payments"}.` : "Nothing regular.",
    detail: due.length ? [...due].sort((x, y) => x.amount - y.amount).slice(0, 3).map((u) => `${u.label} ${gbp(Math.abs(u.amount))} (${shortDate(u.date)})`).join(", ") + "." : "No fixed bills are due in the next 7 days." });
  return out;
}

/** Spend presets: [amount, days from today, wording]. The first one is editable on screen. */
export const SPEND_WHEN: { label: string; days: number }[] = [
  { label: "today", days: 1 }, { label: "this week", days: 5 }, { label: "in 2 weeks", days: 14 }, { label: "next month", days: 30 },
];
export const DEFAULT_SPEND = { personal: 500, business: 5000 } as const;
