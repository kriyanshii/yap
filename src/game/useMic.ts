import { useCallback, useEffect, useRef, useState } from "react";

type SpeechCtor = new () => SpeechRecognition;

function getSpeechCtor(): SpeechCtor | null {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function speechLang(): string {
  const list =
    navigator.languages?.length > 0
      ? [...navigator.languages]
      : [navigator.language];
  const en = list.find((l) => l.toLowerCase().startsWith("en"));
  return en || list[0] || "en-US";
}

function bestText(result: SpeechRecognitionResult): string {
  let best = result[0];
  for (let i = 1; i < result.length; i++) {
    if ((result[i]?.confidence ?? 0) > (best?.confidence ?? 0)) best = result[i];
  }
  return (best?.transcript ?? "").replace(/\s+/g, " ").trim();
}

function mergePhrase(parts: string[], next: string): string[] {
  if (!next) return parts;
  const last = parts[parts.length - 1];
  if (!last) return [next];
  const a = last.toLowerCase();
  const b = next.toLowerCase();
  if (b === a) return parts;
  if (b.startsWith(a)) {
    parts[parts.length - 1] = next;
    return parts;
  }
  if (a.startsWith(b)) return parts;
  if (a.endsWith(b) || b.endsWith(a)) return parts;
  parts.push(next);
  return parts;
}

export function useMic(onUtterance: (text: string) => void) {
  const [supported] = useState(
    () => typeof window !== "undefined" && Boolean(getSpeechCtor()),
  );
  const [holding, setHolding] = useState(false);
  const [heard, setHeard] = useState("");
  const recRef = useRef<SpeechRecognition | null>(null);
  const holdingRef = useRef(false);
  const partsRef = useRef<string[]>([]);
  const interimRef = useRef("");
  const committedRef = useRef(true);
  const onUtteranceRef = useRef(onUtterance);
  onUtteranceRef.current = onUtterance;

  const liveText = useCallback(() => {
    const base = partsRef.current.join(" ").trim();
    const extra = interimRef.current.trim();
    if (!extra) return base;
    if (!base) return extra;
    if (extra.toLowerCase().startsWith(base.toLowerCase())) return extra;
    return `${base} ${extra}`.replace(/\s+/g, " ").trim();
  }, []);

  const publishHeard = useCallback(() => {
    setHeard(liveText());
  }, [liveText]);

  const commit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    const text = liveText();
    partsRef.current = [];
    interimRef.current = "";
    setHeard(text);
    if (text.length < 3) return;
    onUtteranceRef.current(text);
  }, [liveText]);

  const stop = useCallback(() => {
    holdingRef.current = false;
    setHolding(false);
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = bestText(result);
          if (!text) continue;
          if (result.isFinal) {
            partsRef.current = mergePhrase(partsRef.current, text);
            interimRef.current = "";
          } else {
            interimRef.current = text;
          }
        }
        publishHeard();
      };
      rec.onend = () => {
        commit();
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
      };
      try {
        rec.stop();
      } catch {
        commit();
      }
      window.setTimeout(() => {
        commit();
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
      }, 900);
    } else {
      commit();
    }
  }, [commit, publishHeard]);

  const start = useCallback(() => {
    const Ctor = getSpeechCtor();
    if (!Ctor) return;
    if (recRef.current) {
      try {
        recRef.current.abort();
      } catch {
        /* ignore */
      }
    }
    holdingRef.current = true;
    committedRef.current = false;
    partsRef.current = [];
    interimRef.current = "";
    setHeard("");
    setHolding(true);

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.lang = speechLang();
    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = bestText(result);
        if (!text) continue;
        if (result.isFinal) {
          partsRef.current = mergePhrase(partsRef.current, text);
          interimRef.current = "";
        } else {
          interimRef.current = text;
        }
      }
      publishHeard();
    };
    rec.onerror = () => {
      /* keep holding; Chrome often fires no-speech / aborted */
    };
    rec.onend = () => {
      if (!holdingRef.current) return;
      try {
        rec.start();
      } catch {
        /* ignore restart failure */
      }
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      holdingRef.current = false;
      setHolding(false);
    }
  }, [publishHeard]);

  useEffect(() => () => {
    holdingRef.current = false;
    try {
      recRef.current?.abort();
    } catch {
      /* ignore */
    }
  }, []);

  return { supported, holding, heard, start, stop };
}
