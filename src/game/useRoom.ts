import { useCallback, useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import type { DebugEntry, PublicState, ServerMessage, YapStatus } from "../../party/types";

export type Secret = { clue: string; banned: string[] };
export type PublicGuess = { name: string; text: string; correct: boolean };
/** What the yapper's last utterance did; `n` counts results so the UI can tell a new one arrived. */
export type YapResult = { status: YapStatus; text: string; n: number };

export function partyHost(): string {
  const env = import.meta.env.VITE_PARTYKIT_HOST as string | undefined;
  if (env) return env;
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "127.0.0.1:1999";
  return window.location.host;
}

export function useRoom(code: string | null, name: string) {
  const [state, setState] = useState<PublicState | null>(null);
  const [youId, setYouId] = useState<string | null>(null);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [debug, setDebug] = useState<DebugEntry[]>([]);
  const [yapResult, setYapResult] = useState<YapResult | null>(null);
  const [guesses, setGuesses] = useState<PublicGuess[]>([]);
  const [toasts, setToasts] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<PartySocket | null>(null);
  const stateRef = useRef<PublicState | null>(null);
  const nameRef = useRef(name);
  nameRef.current = name;

  const pushToast = useCallback((text: string) => {
    setToasts((t) => [...t.slice(-4), text]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x !== text));
    }, 3200);
  }, []);

  useEffect(() => {
    if (!code) {
      socketRef.current?.close();
      socketRef.current = null;
      setState(null);
      setYouId(null);
      setSecret(null);
      setGuesses([]);
      setConnected(false);
      return;
    }

    const socket = new PartySocket({
      host: partyHost(),
      room: code.toUpperCase(),
      party: "main",
    });
    socketRef.current = socket;

    const join = () => {
      setConnected(true);
      socket.send(JSON.stringify({ type: "join", name: nameRef.current }));
    };

    socket.addEventListener("open", join);
    if (socket.readyState === WebSocket.OPEN) join();

    socket.addEventListener("close", () => setConnected(false));

    socket.addEventListener("message", (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }

      if (msg.type === "you") {
        setYouId(msg.id);
        return;
      }
      if (msg.type === "secret") {
        setSecret({ clue: msg.clue, banned: msg.banned });
        return;
      }
      if (msg.type === "guess") {
        setGuesses((g) => [...g, { name: msg.name, text: msg.text, correct: msg.correct }]);
        return;
      }
      if (msg.type === "toast") {
        pushToast(msg.text);
        return;
      }
      if (msg.type === "debug") {
        setDebug(msg.entries);
        return;
      }
      if (msg.type === "yapResult") {
        setYapResult((prev) => ({ status: msg.status, text: msg.text, n: (prev?.n ?? 0) + 1 }));
        return;
      }
      if (msg.type === "state") {
        const prev = stateRef.current;
        if (!prev || prev.round !== msg.state.round) {
          setSecret(null);
          setGuesses([]);
          setYapResult(null);
        }
        if (msg.state.phase !== "countdown" && msg.state.phase !== "playing") {
          setSecret(null);
        }
        if (msg.state.phase === "lobby") {
          setGuesses([]);
        }
        stateRef.current = msg.state;
        setState(msg.state);
      }
    });

    return () => {
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [code, pushToast]);

  const send = useCallback((body: object) => {
    socketRef.current?.send(JSON.stringify(body));
  }, []);

  return {
    state,
    youId,
    secret,
    guesses,
    debug,
    yapResult,
    toasts,
    connected,
    send,
    pushToast,
  };
}
