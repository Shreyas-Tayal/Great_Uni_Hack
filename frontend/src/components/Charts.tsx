import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Invoice, Summary } from "@/lib/types";
import { gbp, shortDate } from "@/lib/format";
import { draftInvoiceChaser, sendEmail } from "@/lib/api";

export function CategoryChart({ data }: { data: Summary["categories_90d"] }) {
  const rows = data.slice(0, 7);
  return (
    <div className="fs-surface p-3" style={{ height: 40 + rows.length * 36 }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="category" width={130} tick={{ fontSize: 12, fill: "var(--fs-ink)" }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v: number) => gbp(v)} cursor={{ fill: "var(--fs-violet-soft)" }} />
          <Bar dataKey="amount" fill="var(--fs-violet)" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CashflowChart({ data }: { data: Summary["monthly"] }) {
  const rows = data.slice(-12).map((m) => ({ ...m, label: new Date(m.month + "-01").toLocaleDateString("en-GB", { month: "short" }) }));
  return (
    <div className="fs-surface p-3" style={{ height: 240 }}>
      <ResponsiveContainer>
        <BarChart data={rows}>
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--fs-ink-2)" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => gbp(v)} width={72} tick={{ fontSize: 12, fill: "var(--fs-ink-2)" }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v: number) => gbp(v)} />
          <Bar dataKey="in" name="Money in" fill="var(--fs-safe)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="out" name="Money out" fill="var(--fs-ink-2)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Business: unpaid invoices with an AI-drafted reminder the owner approves before sending (n8n). */
export function InvoiceTable({ items, profileId }: { items: Invoice[]; profileId: string }) {
  const [draft, setDraft] = useState<{ id: string; subject: string; body: string; to: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function draftFor(inv: Invoice) {
    setStatus("Drafting…");
    const d = await draftInvoiceChaser(profileId, inv.id, inv.status === "overdue" ? "firm" : "friendly");
    setDraft({ id: inv.id, to: "", ...d });
    setStatus(null);
  }
  async function send() {
    if (!draft) return;
    if (!draft.to.includes("@")) return setStatus("Add the client's email address first.");
    await sendEmail(draft.to, draft.subject, draft.body);
    setStatus(`Reminder sent for ${draft.id}.`);
    setDraft(null);
  }

  return (
    <div className="fs-surface overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[var(--fs-ink-2)]">
          <tr><th className="px-4 py-2 font-medium">Client</th><th className="font-medium">Due</th><th className="font-medium">Amount</th><th className="font-medium">Status</th><th /></tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-t border-[var(--fs-line)]">
              <td className="px-4 py-2">{i.client}</td>
              <td>{shortDate(i.due)}</td>
              <td>{gbp(i.amount)}</td>
              <td className={i.status === "overdue" ? "text-[var(--fs-risk)]" : ""}>{i.status === "overdue" ? `${i.days_late} days late` : "Not due yet"}</td>
              <td className="pr-4 text-right">
                <button className="fs-focus text-[var(--fs-violet)] hover:underline" onClick={() => draftFor(i)}>Draft reminder</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {draft && (
        <div className="border-t border-[var(--fs-line)] p-4">
          <input className="fs-focus mb-2 w-full rounded-md border border-[var(--fs-line)] px-3 py-2 text-sm" placeholder="Client email" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <input className="fs-focus mb-2 w-full rounded-md border border-[var(--fs-line)] px-3 py-2 text-sm font-medium" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          <textarea className="fs-focus h-36 w-full rounded-md border border-[var(--fs-line)] px-3 py-2 text-sm" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <div className="mt-2 flex gap-2">
            <button className="fs-focus rounded-md bg-[var(--fs-violet)] px-3 py-2 text-sm text-white" onClick={send}>Send reminder</button>
            <button className="fs-focus rounded-md px-3 py-2 text-sm" onClick={() => setDraft(null)}>Discard</button>
          </div>
        </div>
      )}
      {status && <div className="px-4 pb-3 text-sm text-[var(--fs-ink-2)]">{status}</div>}
    </div>
  );
}
