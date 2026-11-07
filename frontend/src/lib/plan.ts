// The "handles it for you" layer. Turns the engine's forecast into an opening briefing, and turns an
// approved fix into concrete follow-ups: a drafted message, a tracked target, a reminder. Numbers come
// from the engine; this file only words them and decides what to prepare next.
import type { Adjustment, Approval, Block, ChatMessage, Draft, Forecast, SimulateResponse, Summary, Task } from "./types";
import { gbp, inTen, shortDate } from "./format";

const flat = (a: Adjustment): Adjustment[] => (a.type === "combo" ? a.items.flatMap(flat) : [a]);
const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** "Do both: ask to move X and halve Y" -> "ask to move X and halve Y" */
export const plain = (label: string) => { const l = label.replace(/^do both:\s*/i, ""); return l.charAt(0).toLowerCase() + l.slice(1); };
const hello = () => { const h = new Date().getHours(); return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening"; };

const chart = (f: Forecast): Block => ({ type: "forecast_chart", data: { history: f.history, bands: f.bands, alerts: f.alerts } });

/** The first thing you see: what the accountant noticed overnight, with fixes ready to approve. */
export function briefing(f: Forecast, s: Summary): ChatMessage {
  const biz = s.mode === "business";
  const a = f.alerts[0];
  const who = biz ? s.name : s.name.split(" ")[0];
  const open = biz
    ? `${hello()}. ${s.name} has ${gbp(f.balance_now)} in the bank today.`
    : `${hello()}, ${who}. You've got ${gbp(f.balance_now)} in your account today.`;
  if (!a) {
    const body = biz
      ? (f.hero.value == null ? " Cash grows over the next 90 days and I can't see a crunch coming." : ` At this pace there are about ${f.hero.value} weeks of runway, and nothing dips below £0 in the next 90 days.`)
      : ` You can safely spend about ${gbp(f.hero.value)} over the next two weeks, and nothing dips below £0 in the next 90 days.`;
    return { role: "assistant", content: `${open}${body}\n\nI'll keep watching and tell you the moment that changes. Ask me anything, or try a what-if.`, blocks: [chart(f)] };
  }
  const later = f.alerts.slice(1);
  const worst = later.reduce<typeof a | null>((m, x) => (!m || x.p_negative > m.p_negative ? x : m), null);
  const more = worst ? ` I'm also watching ${later.length} more ${later.length === 1 ? "dip" : "dips"} after that` +
    (worst.p_negative > a.p_negative ? `, the worst around ${shortDate(worst.peak_date)} (${inTen(worst.p_negative)}).` : ".") : "";
  const fix = a.actions?.[0];
  return {
    role: "assistant",
    content: `${open} One thing needs your attention.\n\n**${a.explanation}**${more}` +
      (fix ? `\n\nHere's what I'd do first: **${plain(fix.label)}**. That takes the risk from ${inTen(a.p_negative)} to ${inTen(fix.new_p_negative)}. Approve it below and I'll prepare everything.` : ""),
    blocks: [chart(f), { type: "alert", alert: a }],
  };
}

function letterFor(payee: string, amount: number, due: string, days: number, s: Summary): Draft {
  const biz = s.mode === "business";
  const sign = biz ? `${s.name}` : s.name.split(" ")[0];
  return {
    to: payee,
    subject: `Request to move the ${shortDate(due)} payment by ${days} days`,
    body: `Hello,\n\n${biz ? "Our" : "My"} payment of ${gbp(Math.abs(amount))} to ${payee} is due on ${longDate(due)}. ` +
      `This time the date falls just before ${biz ? "our" : "my"} money comes in, so I'd like to ask whether it could be taken on ${longDate(addDays(due, days))} instead, just for this payment.\n\n` +
      `${biz ? "We're" : "I'm"} up to date and want to make sure it goes through without a problem. Could you confirm whether that's possible?\n\nThank you,\n${sign}`,
  };
}

/** What the accountant does once you approve a fix. */
export function onApprove(adjustment: Adjustment, label: string, f: Forecast, s: Summary, sim: SimulateResponse | null): { message: ChatMessage; approval: Approval } {
  const parts = flat(adjustment);
  const tasks: Task[] = [];
  const blocks: Block[] = [];
  const lines: string[] = [];
  const stream = (id: string) => s.recurring.find((r) => r.stream_id === id);
  const id = () => Math.random().toString(36).slice(2, 9);

  for (const p of parts) {
    if (p.type === "shift_stream") {
      const r = stream(p.stream_id);
      const payee = r?.label ?? "the payee";
      // the date that causes the problem: from the alert itself, then the stream's next date, then the 30-day list
      const cause = f.alerts.flatMap((al) => (al as { causes?: { stream_id: string; date: string }[] }).causes ?? []).find((c) => c.stream_id === p.stream_id);
      const due = cause?.date ?? (r?.next_date && r.next_date >= f.as_of ? r.next_date : f.upcoming.find((u) => u.stream_id === p.stream_id)?.date ?? f.as_of);
      if (/hmrc/i.test(payee)) {
        lines.push(`HMRC doesn't move dates by letter, so the way to do this is a Time to Pay arrangement. You can set one up online or by phone before ${shortDate(due)}. Have your UTR and bank details ready, and I'll keep the new dates in your plan.`);
        tasks.push({ id: id(), title: "Set up Time to Pay with HMRC", detail: `Before ${shortDate(due)}, online or by phone`, status: "needs_you" });
      } else {
        blocks.push({ type: "draft", draft: letterFor(payee, r?.amount ?? 0, due, p.days, s) });
        lines.push(`I've drafted a message to ${payee} asking to move the ${shortDate(due)} payment ${p.days} days later. Check it, then send it from your email.`);
        tasks.push({ id: id(), title: `Send the request to ${payee}`, detail: `Draft ready, move ${shortDate(due)} by ${p.days} days`, status: "needs_you" });
      }
    } else if (p.type === "cut_spend") {
      lines.push(`I've set a target of ${gbp(p.weekly)} less a week on day-to-day spending. I'll check in every Monday and nudge you if you're running over.`);
      tasks.push({ id: id(), title: `Spend ${gbp(p.weekly)} less a week`, detail: "Weekly check-in on Mondays", status: "done" });
    } else if (p.type === "remove_stream") {
      const r = stream(p.stream_id);
      lines.push(`Pause ${r?.label ?? "the subscription"} in its account settings${r?.next_date ? ` before ${shortDate(r.next_date)}` : ""}. I've taken it out of your plan.`);
      tasks.push({ id: id(), title: `Pause ${r?.label ?? "the subscription"}`, detail: r?.next_date ? `Before ${shortDate(r.next_date)}` : "In its account settings", status: "needs_you" });
    } else if (p.type === "scale_stream") {
      const r = stream(p.stream_id);
      const now = Math.abs(r?.amount ?? 0);
      lines.push(`${r?.label ?? "That payment"} drops from ${gbp(now)} to ${gbp(now * p.factor)} until the tight spell passes. I'll tell you when it's safe to go back up.`);
      tasks.push({ id: id(), title: `${r?.label ?? "Payment"} set to ${gbp(now * p.factor)}`, detail: "Until the crunch passes", status: "done" });
    } else if (p.type === "invoice_on_time") {
      const overdue = s.invoices.filter((i) => i.status === "overdue");
      lines.push(overdue.length ? `${overdue.length} ${overdue.length === 1 ? "invoice is" : "invoices are"} overdue. Tap "Draft reminder" and I'll write each chaser for you to check.` : "Nothing is overdue yet. I'll draft reminders the day anything slips.");
      if (s.invoices.length) blocks.push({ type: "invoices", items: s.invoices });
      tasks.push({ id: id(), title: "Chase overdue invoices", detail: overdue.length ? `${overdue.length} to send` : "Watching due dates", status: overdue.length ? "needs_you" : "done" });
    } else if (p.type === "invoice_finance") {
      lines.push(`Invoice finance would advance ${Math.round((p.advance ?? 0.8) * 100)}% of unpaid invoices now. Your bank can quote fees, so ask them before you commit.`);
      tasks.push({ id: id(), title: "Ask the bank about invoice finance", detail: "Compare the fee with the risk it removes", status: "needs_you" });
    }
  }

  const fa = sim?.focus_alert;
  const result = `Done. I've added this to your plan: ${plain(label)}.` +
    (fa ? ` Around ${shortDate(fa.peak_date)}, the chance of going below £0 moves from ${inTen(fa.p_before)} to ${inTen(fa.p_after)}.` : "");
  if (fa) blocks.unshift({ type: "scenario_delta", focus: fa });
  return { message: { role: "assistant", content: `${result}\n\n${lines.join("\n\n")}`, blocks }, approval: { id: id(), label, adjustment, tasks } };
}
