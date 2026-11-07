// Animates a number towards its new value so changes feel alive (respects reduced motion).
import { useEffect, useRef, useState } from "react";

export function useCountUp(target: number | null, ms = 500) {
  const [val, setVal] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (target == null || from.current == null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVal(target); from.current = target; return;
    }
    const start = performance.now(), a = from.current, b = target;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - k, 3);
      setVal(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}
