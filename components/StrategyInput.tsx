"use client";
import { useEffect, useRef, useState } from "react";

export default function StrategyInput(props: {
  text: string;
  setText: (t: string) => void;
  onSubmit: () => void;
  busy: boolean;
  aiEnabled: boolean | null;
  onLoadExample: () => void;
}) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recRef = useRef<any>(null);
  const baseRef = useRef("");

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) setSupported(false);
  }, []);

  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "en-IN";
    rec.continuous = true;
    rec.interimResults = true;
    baseRef.current = props.text ? props.text.trimEnd() + " " : "";
    rec.onresult = (e: any) => {
      let finalText = "", interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      props.setText(baseRef.current + finalText + interim);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  return (
    <div className="card">
      <h2><span className="step">1</span>Describe the strategy</h2>
      <p className="sub">Speak or type it the way you&apos;d explain it to a friend: when you enter, which strikes, how much premium, what you do when the market moves, and when you exit.</p>
      <textarea
        className="big"
        value={props.text}
        onChange={(e) => props.setText(e.target.value)}
        placeholder="e.g. Every Wednesday at 9:16 sell a Nifty strangle that collects about 0.5% of my capital for the week. Keep strikes at least 1.5% away. If Nifty gaps more than 1%, close and re-enter a new strangle that recovers the loss. Exit Monday at 3:30."
      />
      <div className="row" style={{ marginTop: 12 }}>
        <button className={`btn ${listening ? "rec mic-live" : ""}`} onClick={toggleMic} disabled={!supported} title={supported ? "" : "Voice input works in Chrome, Edge and Safari"}>
          <MicIcon /> {listening ? "Listening… tap to stop" : "Speak"}
        </button>
        <button className="chip" onClick={props.onLoadExample}>Load Papa&apos;s voice-note strategy</button>
        <div className="spacer" />
        <button className="btn primary big" onClick={props.onSubmit} disabled={props.busy || props.text.trim().length < 15}>
          {props.busy ? <><span className="spinner" /> Reading your strategy…</> : "Understand my strategy →"}
        </button>
      </div>
      {!supported && <p className="small muted" style={{ marginTop: 8 }}>Voice input isn&apos;t available in this browser. Use Chrome, Edge or Safari, or your phone keyboard&apos;s mic button.</p>}
      {props.aiEnabled === false && (
        <div className="callout warn" style={{ marginTop: 12 }}>
          AI isn&apos;t switched on yet (no Anthropic API key on the server). You can still set every rule by hand in step 2 and run the backtest.
        </div>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  );
}
