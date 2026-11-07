// Built-in accountant brain (no AI). Answers a wide set of questions straight from engine data.
// Used when no AI route is connected, or as the fallback if AI fails. Never invents numbers;
// if it doesn't understand, it says so and offers questions it can answer.
import type { Adjustment, Block, ChatResponse, Forecast, Mode, Summary } from "./types";
import { getForecast, getSummary, simulate } from "./api";
import { gbp, inTen, shortDate } from "./format";

const has = (q: string, re: RegExp) => re.test(q);
const money = (s: string) => { const m = s.replace(/,/g, "").match(/£\s?(\d{2,6})|(\d{2,6})\s*(pounds|quid)/); return m ? Number(m[1] ?? m[2]) : null; };
const pct = (s: string) => { const m = s.match(/(\d{1,3})\s*(%|percent)/); return m ? Number(m[1]) : null; };
const CADENCE: Record<string, string> = { weekly: "every week", fortnightly: "every 2 weeks", four_weekly: "every 4 weeks",
  monthly: "every month", quarterly: "every quarter", semiannual: "twice a year", annual: "once a year", "weekly (variable)": "most weeks, varies" };
const every = (c: string) => CADENCE[c] ?? c;
const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

function reply(text: string, blocks: Block[] = [], adjustments: Adjustment[] = [], intent = "local"): ChatResponse {
  return { reply: text, speak: "", intent, adjustments, blocks, audio_base64: null, audio_mime: "audio/mpeg" };
}
const chart = (f: Forecast): Block => ({ type: "forecast_chart", data: { history: f.history, bands: f.bands, alerts: f.alerts } });
const kpis = (f: Forecast): Block => ({ type: "kpis", items: [{ label: f.hero.label, value: f.hero.value, unit: f.hero.unit }, ...(f.hero.kpis ?? [])] });

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Finds a future date mentioned in the question, as an ISO string, or null. */
function findDate(q: string, today: string): string | null {
  const t = new Date(today);
  const at = (d: Date) => d.toISOString().slice(0, 10);
  const plus = (n: number) => { const d = new Date(t); d.setDate(d.getDate() + n); return at(d); };
  const next = (m: number, day: number) => { const d = new Date(Date.UTC(t.getFullYear(), m, day)); if (d <= t) d.setUTCFullYear(d.getUTCFullYear() + 1); return at(d); };
  if (has(q, /christmas eve/)) return next(11, 24);
  if (has(q, /christmas|xmas/)) return next(11, 25);
  if (has(q, /new year/)) return next(0, 1);
  if (has(q, /tomorrow/)) return plus(1);
  if (has(q, /next week/)) return plus(7);
  if (has(q, /next month/)) return plus(30);
  const inN = q.match(/in (\d{1,2}) (day|week|month)s?/);
  if (inN) return plus(Number(inN[1]) * (inN[2] === "day" ? 1 : inN[2] === "week" ? 7 : 30));
  if (has(q, /end of (the |this )?month/)) return at(new Date(Date.UTC(t.getFullYear(), t.getMonth() + 1, 0)));
  const dm = q.match(/(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  const md = q.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (dm) return next(MONTHS.indexOf(dm[2]), Number(dm[1]));
  if (md) return next(MONTHS.indexOf(md[1]), Number(md[2]));
  const mo = q.match(/\b(?:in|during|for|by|end of)\s+(january|february|march|april|may|june|july|august|september|october|november|december)/);
  if (mo) return next(MONTHS.indexOf(mo[1].slice(0, 3)), 15);
  return null;
}

const SYNONYMS: Record<string, string[]> = {
  rent: ["rent", "housing", "homes", "property", "landlord"], energy: ["energy", "gas", "electric", "octopus"],
  council: ["council", "nndr", "rates"], phone: ["phone", "mobile", "giffgaff"], broadband: ["broadband", "internet", "virgin", "wifi"],
  water: ["water", "utilities"], netflix: ["netflix"], spotify: ["spotify"], gym: ["gym", "puregym"], vat: ["vat"],
  paye: ["paye"], payroll: ["payroll", "staff"], insurance: ["insurance", "hiscox", "zego"],
  klarna: ["klarna", "bnpl"], suppliers: ["supplier", "roasters", "dairy", "booker"],
};
const GENERIC = new Set(["when", "what", "much", "next", "does", "will", "have", "many", "payment", "payments", "money", "month",
  "this", "that", "from", "with", "about", "paid", "bill", "bills", "going", "coming", "afford", "balance", "account", "should", "could",
  "would", "where", "there", "their", "they", "your", "mine", "days", "week", "weeks", "today", "tell", "show", "know", "want", "need"]);
function findStreams(q: string, s: Summary) {
  const words = new Set<string>();
  for (const syn of Object.values(SYNONYMS)) if (syn.some((w) => new RegExp(`\\b${w}`).test(q))) syn.forEach((w) => words.add(w));
  q.split(/[^a-z]+/).filter((w) => w.length >= 4 && !GENERIC.has(w)).forEach((w) => words.add(w));
  return s.recurring.filter((r) => [...words].some((w) => r.label.toLowerCase().includes(w)));
}

const HELP = (biz: boolean) => biz
  ? ["What's my runway?", "What payments are due this month?", "What will my balance be on 24 December?", "When is VAT due?", "Which invoices should I chase?", "What if sales drop 20%?"]
  : ["How am I looking for the next 3 months?", "What will my balance be at Christmas?", "When is my rent due?", "When do I get paid?", "Where is my money going?", "What if my boiler breaks next week?"];

export async function localAnswer(profileId: string, mode: Mode, message: string): Promise<ChatResponse> {
  const q = message.toLowerCase().replace(/[’']/g, "'");
  const [f, s] = await Promise.all([getForecast(profileId), getSummary(profileId)]);
  const biz = mode === "business";

  // 1) What-ifs (change the canvas)
  const adjustments: Adjustment[] = [];
  let what = "";
  if (has(q, /what if|what happens if|suppose|imagine|if i |if we |if my |if our |could i afford|can i afford|can we afford|hire/)) {
    if (has(q, /hire|hiring|employ|new staff|take on/)) {
      const cost = money(q) ?? 2500;
      [30, 60].forEach((d) => adjustments.push({ type: "one_off", amount: -cost, in_days: d, label: "New hire" }));
      what = `hiring someone at about ${gbp(cost)} a month from next month`;
    } else if (biz && has(q, /late|delay|pay(s)? .*later/)) {
      const d = Number(q.match(/(\d{1,3})\s*day/)?.[1] ?? 30);
      adjustments.push({ type: "client_late", extra_days: d });
      what = `clients paying ${d} days later than usual`;
    } else if (has(q, /rise|raise|increase|more (income|work|hours|sales)|grow/) && !has(q, /bill|cost|price|rent/)) {
      const p = pct(q) ?? 10;
      adjustments.push({ type: "income_change", factor: 1 + p / 100 });
      what = `${biz ? "sales" : "income"} rising by ${p}%`;
    } else if (has(q, /lose|lost|cut|drop|fall|reduce|less (income|work|hours|sales)|shift|job|hours|sick|ill\b/)) {
      const p = pct(q) ?? (has(q, /job|everything/) ? 100 : 20);
      adjustments.push({ type: "income_change", factor: Math.max(0, 1 - p / 100) });
      what = `${biz ? "sales" : "income"} falling by ${p}%`;
    } else if (has(q, /boiler|repair|broke|break|car|unexpected|surprise|emergency|bill|vet|fine|spend|buy|holiday|trip|laptop|phone/)) {
      const amt = money(q) ?? Number(q.match(/\b(\d{2,6})\b/)?.[1] ?? (biz ? 2000 : 300));
      const days = has(q, /next week/) ? 7 : has(q, /tomorrow/) ? 1 : has(q, /next month/) ? 30 : 14;
      adjustments.push({ type: "one_off", amount: -amt, in_days: days, label: "One-off cost" });
      what = `a one-off cost of ${gbp(amt)} in ${days} days`;
    } else if (has(q, /save|spend less|cut back/)) {
      const w = money(q) ?? (biz ? 200 : 20);
      adjustments.push({ type: "cut_spend", weekly: w });
      what = `spending ${gbp(w)} less a week`;
    }
  }
  if (adjustments.length) {
    const r = await simulate(profileId, adjustments);
    const fa = r.focus_alert, low = r.scenario.risk_summary;
    return reply(`With ${what}, your lowest point is likely around ${shortDate(low.low_point_date)} at ${gbp(low.low_point_p50)}.` +
      (fa ? ` Around ${shortDate(fa.peak_date)}, the chance of going below £0 moves from ${inTen(fa.p_before)} to ${inTen(fa.p_after)}.` : "") +
      `\n\nI've put this on the chart so you can compare it with today's plan.`,
      [...(fa ? [{ type: "scenario_delta", focus: fa } as Block] : []), chart(r.scenario)], adjustments, "whatif");
  }

  // 2) Greetings and help
  if (has(q, /^(hi|hello|hey|hiya|good (morning|afternoon|evening))\b/) || has(q, /what can you (do|answer)|help me|how does this work/)) {
    return reply(`Hi ${s.name}. I look 90 days ahead at ${biz ? "the business's" : "your"} money and flag tight spots before they happen. You could ask:\n\n${HELP(biz).map((h) => `- ${h}`).join("\n")}`, [kpis(f)]);
  }

  // 3) A specific payee or bill ("when is my rent due", "how much is VAT")
  const streams = findStreams(q, s);
  if (streams.length && !has(q, /spend(ing)? on|where/)) {
    const lines = streams.slice(0, 3).map((r) => `${r.label}: ${gbp(Math.abs(r.amount))} ${r.direction === "in" ? "in" : "out"}, ${every(r.cadence)}` +
      (r.next_date ? `, next on ${longDate(r.next_date)}` : ""));
    const items = f.upcoming.filter((u) => streams.some((r) => r.stream_id === u.stream_id));
    return reply(lines.join("\n") + (items.length ? "" : "\n\nNothing from this is due in the next 30 days."),
      items.length ? [{ type: "upcoming", items }] : [], [], "payee");
  }

  // 4) Balance on a specific date ("at Christmas", "on 15 Dec", "end of the month")
  const when = findDate(q, f.as_of);
  if (when) {
    const b = f.bands.find((x) => x.date >= when) ?? f.bands[f.bands.length - 1];
    return reply(`On ${longDate(b.date)}, your balance is most likely around ${gbp(b.p50)}, somewhere between ${gbp(b.p10)} and ${gbp(b.p90)}.` +
      (b.p_negative >= 0.05 ? ` There's about a ${inTen(b.p_negative)} chance it's below £0 that day.` : " It's very unlikely to be below £0."),
      [chart(f)], [], "date");
  }

  // 5) Balance now
  if (has(q, /balance|how much (money )?(do|have) (i|we) (have|got)|in (my|the|our) (account|bank)|right now|currently/)) {
    return reply(`${biz ? "The business has" : "You have"} ${gbp(f.balance_now)} in the bank today (${shortDate(f.as_of)}). ` +
      (biz ? (f.hero.value == null ? "Cash is growing over the next 90 days." : `Cash runway is about ${f.hero.value} weeks.`)
           : `You can safely spend about ${gbp(f.hero.value)} over the next two weeks.`), [kpis(f)], [], "balance");
  }

  // 6) Overdrawn / run out / lowest point / safe
  if (has(q, /overdrawn|overdraft|go negative|below zero|run out|broke|lowest|worst|tight|danger|risk|safe|okay|\bok\b|fine|enough|afford/)) {
    const a = f.alerts[0], low = f.risk_summary;
    return reply(a
      ? `Your tightest point is around ${longDate(a.peak_date)}: ${a.explanation} The lowest likely balance in the next 90 days is ${gbp(low.low_point_p50)} around ${shortDate(low.low_point_date)}.\n\nTap a fix below to see what changes.`
      : `You look safe: no day in the next 90 has a meaningful chance of going below £0. The lowest likely balance is ${gbp(low.low_point_p50)} around ${shortDate(low.low_point_date)}.`,
      a ? [{ type: "alert", alert: a }, chart(f)] : [chart(f)], [], "risk");
  }

  // 7) Income / payday
  if (has(q, /paid|payday|pay day|wages|salary|income|takings|revenue|sales|money (come|coming) in|universal credit|\buc\b|loan/)) {
    const ins = s.recurring.filter((r) => r.direction === "in");
    const next = f.upcoming.filter((u) => u.amount > 0);
    return reply(ins.length
      ? `Regular money in: ${ins.map((r) => `${r.label} (${gbp(r.amount)}, ${every(r.cadence)}${r.next_date ? `, next ${shortDate(r.next_date)}` : ""})`).join("; ")}.`
      : "I can't see a regular income pattern in the last few months.", next.length ? [{ type: "upcoming", items: next }] : [], [], "income");
  }

  // 7b) Invoices / who owes us
  if (has(q, /invoice|chase|client|customer.*(pay|owe)|owes? (us|me)|owed|receivable|who owes/)) {
    if (!s.invoices.length) return reply(biz ? "There are no unpaid invoices right now." : "I can't see any money owed to you in your account history.");
    const overdue = s.invoices.filter((i) => i.status === "overdue"), total = s.invoices.reduce((a, i) => a + i.amount, 0);
    return reply(`${s.invoices.length} ${s.invoices.length === 1 ? "invoice is" : "invoices are"} unpaid, worth ${gbp(total)}.` +
      (overdue.length ? ` ${overdue.length} ${overdue.length === 1 ? "is" : "are"} overdue: start with ${overdue[0].client}.` : " None are overdue yet.") +
      `\n\nTap "Draft reminder" and I'll write the email for you to check before it's sent.`, [{ type: "invoices", items: s.invoices }], [], "invoices");
  }

  // 8) Payments due
  if (has(q, /due|upcoming|coming up|payments?|bills?|going out|owe|direct debit|standing order|next (\d+ )?(days|weeks|month)|this month/)) {
    const items = f.upcoming.filter((u) => !u.uncertain || u.amount < 0);
    const out = items.filter((u) => u.amount < 0);
    const total = out.reduce((a, u) => a + u.amount, 0);
    const biggest = [...out].sort((a, b) => a.amount - b.amount).slice(0, 3);
    return reply(out.length
      ? `${out.length} payments go out in the next 30 days, about ${gbp(Math.abs(total))} in total. The biggest are ${biggest.map((u) => `${u.label} (${gbp(Math.abs(u.amount))}, ${shortDate(u.date)})`).join(", ")}.` +
        (f.alerts[0] ? `\n\nWatch ${shortDate(f.alerts[0].peak_date)}: that's when timing is tightest.` : "")
      : "Nothing regular is due out in the next 30 days.", [{ type: "upcoming", items }], [], "upcoming");
  }

  // 9) Spending
  if (has(q, /spend|spending|where.*(money|cash)|categor|breakdown|costs?|expenses|outgoings/)) {
    const cat = s.categories_90d.find((c) => c.category.toLowerCase().split(/[^a-z]+/).some((w) => w.length >= 4 && q.includes(w)));
    if (cat) return reply(`Over the last 90 days, ${biz ? "the business" : "you"} spent ${gbp(cat.amount)} on ${cat.category.toLowerCase()}, about ${gbp((cat.amount / 90) * 30)} a month.`,
      [{ type: "category_chart", data: s.categories_90d }], [], "spending");
    const top = s.categories_90d.slice(0, 3), total = s.categories_90d.reduce((a, c) => a + c.amount, 0);
    return reply(`Over the last 90 days, ${biz ? "the business" : "you"} spent about ${gbp(total)}. The biggest areas were ${top.map((c) => `${c.category} (${gbp(c.amount)})`).join(", ")}.`,
      [{ type: "category_chart", data: s.categories_90d }], [], "spending");
  }

  // 11) History
  if (has(q, /cash ?flow|in and out|monthly|history|last (year|month|quarter)|trend|compared|past/)) {
    const last = s.monthly.slice(-3), inn = last.reduce((a, m) => a + m.in, 0), out = last.reduce((a, m) => a + m.out, 0);
    return reply(`Over the last 3 months, ${gbp(inn)} came in and ${gbp(out)} went out, so ${inn - out >= 0 ? "you're up" : "you're down"} ${gbp(Math.abs(inn - out))}.`,
      [{ type: "cashflow_chart", data: s.monthly }], [], "cashflow");
  }

  // 12) Advice / why
  if (has(q, /what should|advice|tips?|improve|save|how (can|do) (i|we)|why|explain|reason|fix/)) {
    const a = f.alerts[0];
    if (a?.actions?.length) {
      return reply(`${a.explanation}\n\nThe fixes that help most, tested against 1,000 simulated futures:\n${a.actions.map((x) => `- ${x.label}: ${inTen(x.new_p_negative)} chance of going below £0`).join("\n")}`,
        [{ type: "actions", actions: a.actions }], [], "advice");
    }
    const top = s.categories_90d[0];
    return reply(`Things look steady. If you want more breathing room, the biggest area of spending is ${top?.category ?? "day-to-day costs"} (${gbp(top?.amount)} in 90 days): trimming that is usually the quickest win.`,
      [{ type: "category_chart", data: s.categories_90d }], [], "advice");
  }

  // 13) Overview words
  if (has(q, /runway|overview|summary|outlook|forecast|how am i|how are we|how's|how is|look(ing)? like|next (3|three) months|90 days|status/)) {
    const a = f.alerts[0];
    const head = biz ? (f.hero.value == null ? "Cash is growing over the next 90 days." : `At the current pace you have about ${f.hero.value} weeks of cash runway.`)
      : `You can safely spend about ${gbp(f.hero.value)} over the next two weeks.`;
    return reply(`${head}${a ? ` The tightest point is around ${shortDate(a.peak_date)}: ${a.explanation}\n\nTap a fix below to see what changes.` : " No cash crunches in the next 90 days."}`,
      [kpis(f), chart(f), ...(a?.actions?.length ? [{ type: "actions", actions: a.actions } as Block] : [])], [], "overview");
  }

  // 14) Honest fallback
  return reply(`I'm answering without the AI assistant right now, so I can only handle questions about ${biz ? "the business's" : "your"} money, like:\n\n${HELP(biz).map((h) => `- ${h}`).join("\n")}`,
    [], [], "unknown");
}
