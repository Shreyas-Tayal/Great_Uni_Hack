// Free speech-to-text via the browser (Chrome/Edge/Safari). ElevenLabs handles the voice OUT.
import { useCallback, useRef, useState } from "react";

export function useVoiceInput(onFinal: (text: string) => void, lang = "en-GB") {
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const SR = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;

  const start = useCallback(() => {
    if (!SR) return;
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = false;
    rec.onresult = (e: any) => onFinal(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }, [SR, lang, onFinal]);

  const stop = useCallback(() => recRef.current?.stop(), []);
  return { supported: !!SR, listening, start, stop };
}
