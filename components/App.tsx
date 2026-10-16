"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BacktestResult, Dataset, StrategySpec } from "@/lib/types";
import { loadDataset } from "@/lib/data";
import { runBacktest } from "@/lib/engine";
import { computeMetrics, type Metrics } from "@/lib/metrics";
import { DAD_SPEC, DAD_TRANSCRIPT, DEFAULT_SPEC, mergeSpec } from "@/lib/defaults";
import { buildSummary } from "@/lib/summary";
import { runScan, SCAN_PARAMS } from "@/lib/scanner";
import { dateLabel } from "@/lib/format";
import StrategyInput from "./StrategyInput";
import SpecEditor, { type Interpretation } from "./SpecEditor";
import Report, { type Analysis, type Comparison } from "./Report";
import Scanner from "./Scanner";
import Library, { loadLibrary, saveLibrary, type SavedStrategy } from "./Library";
import WeekPlan from "./WeekPlan";

const DAD_INTERP: Interpretation = {
  understanding: [
    "Every week, enter on the first session after the weekly expiry (Wednesday under today's Tuesday expiry) at the 9:16 open.",
    "Sell a short strangle (one out-of-the-money call and one out-of-the-money put) on the current weekly expiry.",
    "Pick the farthest strikes that still collect 0.5% of capital in total premium (about 0.1% a day), split evenly between call and put.",
    "Never sell closer than 1.5% from Nifty. If that's not enough premium, wait and try again the next day.",
    "If Nifty gaps 1% or more at the open, or comes within 0.5% of a sold strike, close both legs and sell a new strangle big enough to recover the loss (at least 1% away). At most 2 adjustments a week.",
    "Exit everything at the close of the session before expiry (Monday 3:30 under Tuesday expiry).",
  ],
  assumptions: [
    "'Comfortable' strikes → I assumed at least 1.5% away from Nifty.",
    "'Big gap up or gap down' → I assumed a 1% move from the previous close.",
    "'Very close' to a strike → I assumed within 0.5% of it.",
    "How many times to re-adjust → I assumed at most 2 times a week, then exit.",
  ],
  questions: ["Is there a maximum loss in a week at which you'd stop for the week?", "When rolling to recover a loss, how close to Nifty are you willing to go?"],
  unsupported: ["Built-in example interpretation (no AI key set). Minute-by-minute moves aren't in daily data, so intraday adjustments are priced with a volatility model."],
};

function fromForPeriod(period: string, end: string) {
  if (period === "tue") return "2025-09-01";
  const y = Number(period);
  const d = new Date(end + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() - y);
  return d.toISOString().slice(0, 10);
}

export default function App() {
  const [tab, setTab] = useState<"build" | "scan" | "week" | "lib">("build");
  const [ds, setDs] = useState<Dataset | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [ai, setAi] = useState<{ ai: boolean; fast?: string; deep?: string } | null>(null);
  const [text, setText] = useState("");
  const [interp, setInterp] = useState<Interpretation | null>(null);
  const [interpreting, setInterpreting] = useState(false);
  const [interpErr, setInterpErr] = useState<string | null>(null);
  const [spec, setSpec] = useState<StrategySpec>(DEFAULT_SPEC);
  const [period, setPeriod] = useState("5");
  const [res, setRes] = useState<BacktestResult | null>(null);
  const [m, setM] = useState<Metrics | null>(null);
  const [running, setRunning] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisErr, setAnalysisErr] = useState<string | null>(null);
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  const [library, setLibrary] = useState<SavedStrategy[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const lastSummary = useRef<any>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadDataset().then(setDs).catch(() => setLoadErr("Couldn't load market data. Refresh the page to try again."));
    fetch("/api/status").then((r) => r.json()).then(setAi).catch(() => setAi({ ai: false }));
    setLibrary(loadLibrary());
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const range = useMemo(() => (ds ? { from: fromForPeriod(period, ds.days[ds.days.length - 1].d) } : {}), [ds, period]);

  const interpret = async () => {
    setInterpreting(true); setInterpErr(null);
    try {
      if (ai && !ai.ai) {
        if (text.trim() === DAD_TRANSCRIPT.trim()) {
          setSpec({ ...DAD_SPEC, sizing: spec.sizing, costs: spec.costs });
          setInterp(DAD_INTERP);
        } else setInterpErr("AI isn't switched on, so set the rules by hand below.");
        return;
      }
      const r = await fetch("/api/interpret", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, currentSpec: spec }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error === "no_key" ? "AI isn't switched on." : j.error);
      const next = mergeSpec(spec, j.spec);
      next.description = text;
      setSpec(next);
      setInterp({ understanding: j.understanding ?? [], assumptions: j.assumptions ?? [], questions: j.questions ?? [], unsupported: j.unsupported ?? [], model: j.model });
      setTimeout(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (e: any) {
      setInterpErr(e.message ?? "Something went wrong");
    } finally {
      setInterpreting(false);
    }
  };

  const analyze = async (r: BacktestResult, mm: Metrics, s: StrategySpec) => {
    if (!ai?.ai) return;
    setAnalyzing(true); setAnalysisErr(null);
    try {
      // a quick robustness scan gives the reviewer context on how sensitive the result is
      const pa = SCAN_PARAMS.find((p) => p.key === "targetPremiumPct")!;
      const pb = SCAN_PARAMS.find((p) => p.key === "minOtmPercent")!;
      const scan = s.strikes.method === "target_premium" && ds ? await runScan(ds, s, pa, pb, range) : null;
      const scanSummary = scan?.map((c) => ({ premiumTargetPct: c.a, comfortFloorPct: c.b, cagr: +c.cagr.toFixed(1), maxDD: +c.maxDD.toFixed(1), worstWeek: +c.worstWeek.toFixed(1), goalWeeksPct: +c.targetHit.toFixed(0) }));
      const summary = buildSummary(r, mm, scanSummary);
      lastSummary.current = summary;
      const resp = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spec: s, summary }) });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j.error);
      setAnalysis(j);
    } catch (e: any) {
      setAnalysisErr(e.message ?? "failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const run = (s: StrategySpec = spec) => {
    if (!ds) return;
    setRunning(true);
    setTab("build");
    setTimeout(() => {
      const r = runBacktest(ds, s, range);
      const mm = computeMetrics(r, ds);
      setRes(r); setM(mm); setAnalysis(null); setComparisons([]); setRunning(false);
      setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      analyze(r, mm, s);
    }, 30);
  };

  const testSuggestion = (sg: Analysis["suggestions"][number]) => {
    if (!ds || !res) return;
    setTesting(sg.title);
    setTimeout(() => {
      const s2 = mergeSpec(res.spec, sg.patch);
      s2.name = sg.title;
      const r = runBacktest(ds, s2, range);
      setComparisons((c) => [...c.filter((x) => x.title !== sg.title), { title: sg.title, spec: s2, m: computeMetrics(r, ds) }]);
      setTesting(null);
    }, 30);
  };

  const save = () => {
    if (!res || !m) return;
    const item: SavedStrategy = {
      id: Math.random().toString(36).slice(2),
      savedAt: new Date().toISOString(),
      text: spec.description || text,
      spec: res.spec,
      summary: { cagr: m.cagr, maxDD: m.maxDDPct, worstWeek: m.worstWeekPct, goalHit: m.targetHitAllPct, totalPnl: m.totalPnl, period: `${dateLabel(res.start)} – ${dateLabel(res.end)}`, grade: analysis?.grade },
    };
    const l = [...library, item];
    setLibrary(l); saveLibrary(l);
    setToast("Saved to My strategies");
  };

  const dataRange = ds ? `NSE data ${dateLabel(ds.days[0].d)} – ${dateLabel(ds.days[ds.days.length - 1].d)}` : "";

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <div className="logo">N</div>
          <div>
            <h1>Nifty Strategy Lab</h1>
            <div className="small muted">Say your strategy. See 5 years of truth.</div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="pill"><span className="dot" style={{ background: ds ? "var(--good)" : "var(--warn)" }} />{ds ? `Data to ${dateLabel(ds.days[ds.days.length - 1].d)}` : loadErr ?? "Loading data…"}</span>
          <span className="pill"><span className="dot" style={{ background: ai?.ai ? "var(--good)" : "var(--muted)" }} />{ai === null ? "…" : ai.ai ? "AI on" : "AI off"}</span>
        </div>
      </header>

      <nav className="tabs">
        {([["build", "Backtest"], ["scan", "Scanner"], ["week", "This week"], ["lib", `My strategies${library.length ? ` (${library.length})` : ""}`]] as const).map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>

      {tab === "build" && (
        <>
          <StrategyInput text={text} setText={setText} onSubmit={interpret} busy={interpreting} aiEnabled={ai ? ai.ai : null}
            onLoadExample={() => setText(DAD_TRANSCRIPT)} />
          {interpErr && <div className="callout crit" style={{ marginBottom: 16 }}>{interpErr}</div>}
          <div ref={editorRef}>
            <SpecEditor spec={spec} setSpec={setSpec} interp={interp} period={period} setPeriod={setPeriod} onRun={() => run()} running={running} dataReady={!!ds} dataRange={dataRange} />
          </div>
          <div ref={reportRef}>
            {res && m && (
              <Report res={res} m={m} analysis={analysis} analyzing={analyzing} analysisError={analysisErr} aiEnabled={ai ? ai.ai : null}
                onRetryAnalysis={() => analyze(res, m, res.spec)} onTest={testSuggestion} testing={testing} comparisons={comparisons}
                onUse={(s) => { setSpec(s); editorRef.current?.scrollIntoView({ behavior: "smooth" }); setToast("Loaded into step 2. Press Run to see the full report."); }}
                onSave={save} />
            )}
          </div>
        </>
      )}
      {tab === "scan" && <Scanner ds={ds} spec={spec} range={range} onLoad={(s) => { setSpec(s); setTab("build"); setToast("Settings loaded into step 2"); }} />}
      {tab === "week" && <WeekPlan ds={ds} setDs={setDs} spec={spec} />}
      {tab === "lib" && <Library items={library} setItems={setLibrary} onOpen={(s) => { setSpec(s.spec); setText(s.text); setInterp(null); run(s.spec); }} />}

      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "var(--ink)", color: "var(--surface)", padding: "10px 16px", borderRadius: 10, fontSize: 14, zIndex: 50 }}>{toast}</div>
      )}
    </div>
  );
}
