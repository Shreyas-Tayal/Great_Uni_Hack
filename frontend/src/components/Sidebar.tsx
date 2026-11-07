// Left rail: who you are (demo accounts), and what your accountant is handling for you.
import { Check, CircleDot, Moon, RotateCcw, Sun, X } from "lucide-react";
import type { Approval, ProfileSummary } from "@/lib/types";
import type { Brain } from "@/lib/api";
import { inTen } from "@/lib/format";

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="var(--fs-violet)" />
        <path d="M7 20c4 0 5-9 9-9s4 6 9 3" stroke="var(--fs-on-accent)" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="25" cy="14" r="2.6" fill="var(--fs-brand-pink)" />
      </svg>
      <div className="leading-tight">
        <div className="fs-display text-lg font-bold">Foresight</div>
        <div className="text-xs text-[var(--fs-ink-2)]">Your AI accountant</div>
      </div>
    </div>
  );
}

const BRAIN: Record<Brain, string> = { n8n: "AI accountant with voice (n8n)", claude: "AI accountant (Claude)", coach: "Built-in coach (demo, no AI)" };

interface Props {
  profiles: ProfileSummary[];
  risks: Record<string, number>;
  pid: string;
  onPick: (id: string) => void;
  approvals: Approval[];
  onUndo: (id: string) => void;
  theme: "light" | "dark";
  onTheme: () => void;
  brain: Brain;
  onClose?: () => void;
}

export default function Sidebar({ profiles, risks, pid, onPick, approvals, onUndo, theme, onTheme, brain, onClose }: Props) {
  const groups: [string, ProfileSummary[]][] = [["Personal", profiles.filter((p) => p.mode === "personal")], ["Business", profiles.filter((p) => p.mode === "business")]];
  const needs = approvals.flatMap((a) => a.tasks).filter((t) => t.status === "needs_you").length;
  return (
    <nav aria-label="Accounts and tasks" className="fs-scroll flex h-full flex-col gap-6 overflow-y-auto bg-[var(--fs-sunk)] p-4">
      <div className="flex items-center justify-between">
        <Logo />
        {onClose && (
          <button onClick={onClose} aria-label="Close menu" className="fs-focus flex h-10 w-10 items-center justify-center rounded-xl hover:bg-[var(--fs-violet-soft)]"><X size={20} /></button>
        )}
      </div>

      <section aria-labelledby="fs-acc">
        <h2 id="fs-acc" className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-[var(--fs-ink-2)]">Demo accounts</h2>
        {groups.map(([label, list]) => list.length > 0 && (
          <div key={label} className="mb-3">
            <div className="px-2 pb-1 text-xs text-[var(--fs-ink-2)]">{label}</div>
            <ul className="flex flex-col gap-0.5">
              {list.map((p) => {
                const r = risks[p.profile_id];
                const risky = r != null && r >= 0.25;
                return (
                  <li key={p.profile_id}>
                    <button onClick={() => onPick(p.profile_id)} aria-current={p.profile_id === pid ? "true" : undefined}
                      className="fs-focus flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-2 text-left text-sm hover:bg-[var(--fs-violet-soft)]"
                      style={p.profile_id === pid ? { background: "var(--fs-paper)", boxShadow: "0 0 0 1px var(--fs-line)" } : undefined}>
                      <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full" style={{ background: r == null ? "var(--fs-line)" : risky ? "var(--fs-risk)" : "var(--fs-up)" }} />
                      <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                      {r != null && <span className="text-xs" style={{ color: risky ? "var(--fs-risk)" : "var(--fs-ink-2)" }}>{risky ? inTen(r) : "Safe"}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <section aria-labelledby="fs-handled" className="flex-1">
        <h2 id="fs-handled" className="mb-2 flex items-center justify-between px-2 text-xs font-semibold uppercase tracking-wide text-[var(--fs-ink-2)]">
          Handled for you
          {needs > 0 && <span className="rounded-full bg-[var(--fs-amber-soft)] px-2 py-0.5 normal-case tracking-normal text-[var(--fs-amber)]">{needs} need{needs === 1 ? "s" : ""} you</span>}
        </h2>
        {approvals.length === 0 ? (
          <p className="px-2 text-sm text-[var(--fs-ink-2)]">Nothing yet. When you approve a fix, I'll track it here.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {approvals.map((a) => (
              <li key={a.id} className="rounded-xl border border-[var(--fs-line)] bg-[var(--fs-paper)] p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 text-sm font-medium">{a.label}</div>
                  <button onClick={() => onUndo(a.id)} aria-label={`Undo: ${a.label}`} title="Undo"
                    className="fs-focus -m-1 flex h-8 w-8 flex-none items-center justify-center rounded-lg text-[var(--fs-ink-2)] hover:bg-[var(--fs-violet-soft)]"><RotateCcw size={15} /></button>
                </div>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {a.tasks.map((t) => (
                    <li key={t.id} className="flex items-start gap-2 text-xs">
                      {t.status === "done"
                        ? <Check size={14} aria-label="Done" className="mt-0.5 flex-none text-[var(--fs-safe)]" />
                        : <CircleDot size={14} aria-label="Needs you" className="mt-0.5 flex-none text-[var(--fs-amber)]" />}
                      <span><span className="font-medium">{t.title}</span><span className="block text-[var(--fs-ink-2)]">{t.detail}</span></span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--fs-line)] pt-3">
        <span className="flex min-w-0 items-center gap-2 text-xs text-[var(--fs-ink-2)]">
          <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full" style={{ background: brain === "coach" ? "var(--fs-amber)" : "var(--fs-up)" }} />
          <span className="truncate">{BRAIN[brain]}</span>
        </span>
        <button onClick={onTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="fs-focus flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-[var(--fs-line)] bg-[var(--fs-paper)]">
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </nav>
  );
}
