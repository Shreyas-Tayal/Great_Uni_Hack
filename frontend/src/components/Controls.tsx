import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import type { Mode, ProfileSummary } from "@/lib/types";
import { CONFIG } from "@/lib/config";

export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div role="radiogroup" aria-label="Personal or business" className="inline-flex rounded-full border border-[var(--fs-line)] bg-[var(--fs-paper)] p-1">
      {(["personal", "business"] as Mode[]).map((m) => (
        <button key={m} role="radio" aria-checked={mode === m} onClick={() => onChange(m)}
          className="fs-focus rounded-full px-4 py-1.5 text-sm capitalize transition-colors"
          style={mode === m ? { background: "var(--fs-ink)", color: "var(--fs-paper)" } : { color: "var(--fs-ink-2)" }}>
          {m}
        </button>
      ))}
    </div>
  );
}

export function ThemeToggle({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  const dark = theme === "dark";
  return (
    <button onClick={onToggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}
      className="fs-focus rounded-full border border-[var(--fs-line)] bg-[var(--fs-paper)] p-2 text-[var(--fs-ink)] hover:border-[var(--fs-violet)]">
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export function ProfilePicker({ profiles, value, onChange }: { profiles: ProfileSummary[]; value: string; onChange: (id: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-[var(--fs-ink-2)]">Demo account</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="fs-focus rounded-md border border-[var(--fs-line)] bg-[var(--fs-paper)] px-2 py-1.5">
        {profiles.map((p) => <option key={p.profile_id} value={p.profile_id}>{p.name}</option>)}
      </select>
    </label>
  );
}

/**
 * "Practise the call": ElevenLabs Conversational AI agent role-plays a landlord / energy company /
 * late-paying client so the user can rehearse asking for more time. Configure the agent in the
 * ElevenLabs dashboard (prompt in contracts/rehearsal_agent_prompt.md), then set VITE_ELEVEN_AGENT_ID.
 */
export function RehearsePanel({ mode }: { mode: Mode }) {
  const agentId = CONFIG.ELEVEN_AGENT_ID;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || !agentId || document.getElementById("el-convai")) return;
    const s = document.createElement("script");
    s.id = "el-convai";
    s.src = "https://unpkg.com/@elevenlabs/convai-widget-embed";
    s.async = true;
    document.body.appendChild(s);
  }, [open, agentId]);

  return (
    <div className="fs-surface p-4">
      <div className="font-semibold">Practise the call first</div>
      <p className="mt-1 text-sm text-[var(--fs-ink-2)]">
        {mode === "business"
          ? "Rehearse asking a client to pay, or HMRC for time to pay, with an AI that plays the other side."
          : "Rehearse asking your landlord or energy supplier for more time, with an AI that plays the other side."}
      </p>
      {!agentId ? (
        <p className="mt-2 text-xs text-[var(--fs-ink-2)]">Add your ElevenLabs agent ID in src/lib/config.ts to turn this on.</p>
      ) : !open ? (
        <button onClick={() => setOpen(true)} className="fs-focus mt-3 rounded-md bg-[var(--fs-ink)] px-3 py-2 text-sm text-[var(--fs-paper)]">Start practice call</button>
      ) : (
        // @ts-expect-error custom element provided by the ElevenLabs embed script
        <elevenlabs-convai agent-id={agentId}></elevenlabs-convai>
      )}
    </div>
  );
}
