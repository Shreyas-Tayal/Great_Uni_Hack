// The heart of the app: a conversation with your accountant. Replies carry charts, fixes and drafts.
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { playAudio } from "@/lib/api";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import BlockRenderer from "./BlockRenderer";

/** Just enough markdown for the accountant: paragraphs, bullet lists and **bold**. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
}
export function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="fs-prose">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>)}</ul>;
        }
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>;
      })}
    </div>
  );
}

function Avatar() {
  return (
    <span aria-hidden="true" className="mt-0.5 hidden h-8 w-8 flex-none sm:flex items-center justify-center rounded-full bg-[var(--fs-violet)] text-[var(--fs-on-accent)]">
      <svg width="18" height="18" viewBox="0 0 32 32" fill="none"><path d="M5 21c5 0 6-11 11-11s5 7 11 4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
    </span>
  );
}

interface Props {
  messages: ChatMessage[];
  busy: boolean;
  profileId: string;
  suggestions: string[];
  placeholder: string;
  voiceOn: boolean;
  onToggleVoice: () => void;
  onSend: (text: string) => void;
  error: string | null;
}

export default function Conversation({ messages, busy, profileId, suggestions, placeholder, voiceOn, onToggleVoice, onSend, error }: Props) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const voice = useVoiceInput(onSend);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, busy]);
  useEffect(() => {   // grow the box with the text, up to about six lines
    const ta = taRef.current; if (!ta) return;
    ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 168) + "px";
  }, [input]);

  const submit = () => { const t = input.trim(); if (!t || busy) return; setInput(""); onSend(t); };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="fs-scroll min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-4 pb-6 pt-6 sm:px-6">
          {messages.map((m, i) => m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-[var(--fs-violet)] px-4 py-2.5 text-[var(--fs-on-accent)]">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="fs-reveal flex gap-3">
              <Avatar />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="break-words leading-relaxed"><Markdown text={m.content} /></div>
                {m.notes?.length ? <ul className="space-y-1 text-xs text-[var(--fs-ink-2)]">{m.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
                {m.audio && (
                  <button onClick={() => playAudio(m.audio!.b64, m.audio!.mime)} className="fs-focus inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-[var(--fs-line)] px-3 text-xs">
                    <Volume2 size={14} aria-hidden="true" /> Play answer
                  </button>
                )}
                {m.blocks?.map((b, j) => <BlockRenderer key={j} block={b} profileId={profileId} />)}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-3 text-sm text-[var(--fs-ink-2)]">
              <Avatar />
              <span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="fs-dot h-1.5 w-1.5 rounded-full bg-[var(--fs-ink-2)]" style={{ animationDelay: `${i * 150}ms` }} />)}</span>
              Checking 1,000 possible futures…
            </div>
          )}
          {error && <div role="alert" className="text-sm text-[var(--fs-risk)]">{error}</div>}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-[var(--fs-line)] bg-[var(--fs-mist)]">
        <div className="mx-auto w-full max-w-[760px] px-4 pb-4 pt-3 sm:px-6">
          {suggestions.length > 0 && (
            <div className="fs-scroll -mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
              {suggestions.map((s) => (
                <button key={s} onClick={() => onSend(s)} disabled={busy}
                  className="fs-focus min-h-[36px] flex-none rounded-full border border-[var(--fs-line)] bg-[var(--fs-paper)] px-3 text-sm hover:bg-[var(--fs-violet-soft)] disabled:opacity-50">{s}</button>
              ))}
            </div>
          )}
          <form className="flex items-end gap-2 rounded-2xl border border-[var(--fs-line)] bg-[var(--fs-paper)] p-2 focus-within:border-[var(--fs-ink-2)]"
            onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <label htmlFor="fs-ask" className="sr-only">Ask your accountant</label>
            <textarea id="fs-ask" ref={taRef} rows={1} value={input} placeholder={placeholder}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              className="max-h-[168px] min-h-[40px] flex-1 resize-none border-0 bg-transparent px-2 py-2 leading-6 outline-none" />
            {voice.supported && (
              <button type="button" aria-label={voice.listening ? "Stop listening" : "Speak your question"} onClick={voice.listening ? voice.stop : voice.start}
                className="fs-focus flex h-10 w-10 flex-none items-center justify-center rounded-xl hover:bg-[var(--fs-violet-soft)]"
                style={voice.listening ? { background: "var(--fs-risk-soft)", color: "var(--fs-risk)" } : undefined}>
                {voice.listening ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
            )}
            <button type="button" aria-label={voiceOn ? "Turn spoken replies off" : "Turn spoken replies on"} aria-pressed={voiceOn} onClick={onToggleVoice}
              className="fs-focus flex h-10 w-10 flex-none items-center justify-center rounded-xl text-[var(--fs-ink-2)] hover:bg-[var(--fs-violet-soft)]">
              {voiceOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <button type="submit" aria-label="Send" disabled={busy || !input.trim()}
              className="fs-focus flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-[var(--fs-violet)] text-[var(--fs-on-accent)] disabled:opacity-30">
              <ArrowUp size={20} />
            </button>
          </form>
          <p className="mt-2 text-center text-xs text-[var(--fs-ink-2)]">Foresight prepares; you approve. Guidance only, not regulated financial advice.</p>
        </div>
      </div>
    </div>
  );
}
