import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Volume2, VolumeX } from "lucide-react";
import type { Adjustment, ChatMessage, Mode } from "@/lib/types";
import { SUGGESTIONS, chat, playAudio } from "@/lib/api";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import BlockRenderer from "./BlockRenderer";

interface Props {
  profileId: string;
  mode: Mode;
  name: string;
  onScenario: (adjustments: Adjustment[], label: string) => void; // AI applied a what-if -> update the canvas
}

export default function ChatPanel({ profileId, mode, name, onScenario }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages([]); setError(null); }, [profileId]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  const send = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg || busy) return;
    const history = [...messages, { role: "user" as const, content: msg }];
    setMessages(history);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await chat({ profile_id: profileId, mode, message: msg, history: messages, voice: voiceOn });
      setMessages([...history, { role: "assistant", content: res.reply, blocks: res.blocks }]);
      if (res.adjustments?.length) onScenario(res.adjustments, msg);
      if (voiceOn) playAudio(res.audio_base64, res.audio_mime);
    } catch (e) {
      setError("Couldn't reach the accountant. Check the n8n webhook is active, then try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, messages, mode, onScenario, profileId, voiceOn]);

  const voice = useVoiceInput(send);

  return (
    <section className="flex h-full min-h-[480px] flex-col" aria-label="Chat with your accountant">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="fs-reveal">
            <h2 className="text-2xl font-semibold leading-tight">
              {mode === "business" ? `What do you want to know about ${name}'s cash?` : `Hi ${name}. What's on your mind about money?`}
            </h2>
            <p className="mt-2 text-[var(--fs-ink-2)]">Ask in your own words, or tap the mic. I'll show you the numbers as we go.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS[mode].map((s) => (
                <button key={s} onClick={() => send(s)} className="fs-focus rounded-full border border-[var(--fs-line)] bg-[var(--fs-paper)] px-3 py-1.5 text-sm hover:border-[var(--fs-violet)]">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "fs-reveal space-y-3"}>
            {m.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--fs-violet)] px-4 py-2 text-white">{m.content}</div>
            ) : (
              <>
                {/* Swap for react-markdown if Lovable has it installed */}
                <div className="whitespace-pre-wrap leading-relaxed">{m.content.replace(/\*\*/g, "")}</div>
                {m.blocks?.map((b, j) => (
                  <BlockRenderer key={j} block={b} profileId={profileId} onApply={(a, label) => onScenario([a], label)} />
                ))}
              </>
            )}
          </div>
        ))}
        {busy && <div className="text-sm text-[var(--fs-ink-2)]">Running the numbers…</div>}
        {error && <div role="alert" className="text-sm text-[var(--fs-risk)]">{error}</div>}
        <div ref={endRef} />
      </div>

      <form className="flex items-center gap-2 border-t border-[var(--fs-line)] p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        {voice.supported && (
          <button type="button" aria-label={voice.listening ? "Stop listening" : "Speak your question"} onClick={voice.listening ? voice.stop : voice.start}
            className="fs-focus rounded-full p-2" style={{ background: voice.listening ? "var(--fs-risk-soft)" : "transparent" }}>
            {voice.listening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
        )}
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your money…"
          className="fs-focus flex-1 rounded-full border border-[var(--fs-line)] bg-[var(--fs-paper)] px-4 py-2" />
        <button type="button" aria-label={voiceOn ? "Turn spoken replies off" : "Turn spoken replies on"} onClick={() => setVoiceOn(!voiceOn)} className="fs-focus rounded-full p-2">
          {voiceOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
        <button type="submit" aria-label="Send" disabled={busy || !input.trim()} className="fs-focus rounded-full bg-[var(--fs-violet)] p-2 text-white disabled:opacity-40">
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}
