"use client";
import { useState } from "react";
import type { Dataset, StrategySpec } from "@/lib/types";
import { getParam, runScan, SCAN_PARAMS, setParam, type ScanCell } from "@/lib/scanner";
import { pct, rupees } from "@/lib/format";

const METRICS: { key: keyof ScanCell; label: string; fmt: (v: number) => string; higherBetter: boolean }[] = [
  { key: "cagr", label: "Yearly return", fmt: (v) => pct(v, 1), higherBetter: true },
  { key: "maxDD", label: "Biggest fall", fmt: (v) => pct(v, 1), higherBetter: true },
  { key: "calmar", label: "Return ÷ biggest fall (Calmar)", fmt: (v) => v.toFixed(2), higherBetter: true },
  { key: "targetHit", label: "% of weeks meeting goal", fmt: (v) => pct(v, 0), higherBetter: true },
  { key: "worstWeek", label: "Worst week", fmt: (v) => pct(v, 1), higherBetter: true },
  { key: "winRate", label: "Winning weeks", fmt: (v) => pct(v, 0), higherBetter: true },
  { key: "totalPnl", label: "Total profit", fmt: (v) => rupees(v, true), higherBetter: true },
];

export default function Scanner(props: { ds: Dataset | null; spec: StrategySpec; range: { from?: string }; onLoad: (s: StrategySpec) => void }) {
  const [a, setA] = useState("targetPremiumPct");
  const [b, setB] = useState("minOtmPercent");
  const [metric, setMetric] = useState<keyof ScanCell>("calmar");
  const [cells, setCells] = useState<ScanCell[] | null>(null);
  const [prog, setProg] = useState<[number, number] | null>(null);
  const [ran, setRan] = useState<{ a: string; b: string } | null>(null);

  const pa = SCAN_PARAMS.find((p) => p.key === a)!;
  const pb = SCAN_PARAMS.find((p) => p.key === b)!;
  const run = async () => {
    if (!props.ds) return;
    setCells(null);
    setProg([0, pa.values.length * pb.values.length]);
    const c = await runScan(props.ds, props.spec, pa, pb, props.range, (d, t) => setProg([d, t]));
    setCells(c);
    setRan({ a, b });
    setProg(null);
  };
  const M = METRICS.find((x) => x.key === metric)!;
  const ra = ran ? SCAN_PARAMS.find((p) => p.key === ran.a)! : pa;
  const rb = ran ? SCAN_PARAMS.find((p) => p.key === ran.b)! : pb;
  const vals = cells?.map((c) => c[metric] as number) ?? [];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const best = cells ? cells.reduce((x, c) => ((c[metric] as number) > (x[metric] as number) ? c : x), cells[0]) : null;
  const curA = getParam(props.spec, ra), curB = getParam(props.spec, rb);

  return (
    <div className="card">
      <h2>Strategy scanner</h2>
      <p className="sub">Runs your strategy many times with two settings changed, to show which combination would have worked best over the same period. A good strategy works across a wide area, not just in one lucky cell.</p>
      <div className="form-grid" style={{ marginBottom: 14 }}>
        <div className="field"><label>Rows: change this</label>
          <select value={a} onChange={(e) => setA(e.target.value)}>{SCAN_PARAMS.filter((p) => p.key !== b).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div>
        <div className="field"><label>Columns: and this</label>
          <select value={b} onChange={(e) => setB(e.target.value)}>{SCAN_PARAMS.filter((p) => p.key !== a).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div>
        <div className="field"><label>Colour cells by</label>
          <select value={metric} onChange={(e) => setMetric(e.target.value as keyof ScanCell)}>{METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></div>
      </div>
      <div className="row">
        <button className="btn primary" onClick={run} disabled={!props.ds || !!prog}>{prog ? <><span className="spinner" /> Running {prog[0]}/{prog[1]}…</> : `Run ${pa.values.length * pb.values.length} backtests →`}</button>
        <span className="small muted">Every other rule stays as set in step 2 ({props.spec.name}).</span>
      </div>
      {prog && <div className="progress" style={{ marginTop: 12 }}><span style={{ width: `${(prog[0] / prog[1]) * 100}%` }} /></div>}

      {cells && (
        <div style={{ marginTop: 18 }}>
          <div className="tscroll">
            <div className="heat" style={{ gridTemplateColumns: `minmax(120px, 160px) repeat(${rb.values.length}, minmax(76px, 1fr))`, minWidth: 140 + rb.values.length * 80 }}>
              <div className="hd" style={{ textAlign: "left" }}>{ra.label.split("(")[0]} ↓ / {rb.label.split("(")[0]} →</div>
              {rb.values.map((v) => <div key={v} className="hd"><b>{rb.fmt(v)}</b></div>)}
              {ra.values.map((av) => [
                <div key={`h${av}`} className="hd" style={{ textAlign: "left" }}><b>{ra.fmt(av)}</b></div>,
                ...rb.values.map((bv) => {
                  const c = cells.find((x) => x.a === av && x.b === bv)!;
                  const v = c[metric] as number;
                  const k = hi > lo ? (v - lo) / (hi - lo) : 0.5;
                  const isCur = av === curA && bv === curB;
                  const bad = metric === "cagr" || metric === "totalPnl" ? v < 0 : false;
                  return (
                    <button key={`${av}-${bv}`} className="c" onClick={() => props.onLoad(setParam(setParam(props.spec, ra, av), rb, bv))}
                      title={`Yearly ${pct(c.cagr, 1)} · fall ${pct(c.maxDD, 1)} · worst week ${pct(c.worstWeek, 1)} · goal weeks ${pct(c.targetHit, 0)}. Click to load these settings.`}
                      style={{
                        border: isCur ? "2px solid var(--ink)" : "0", cursor: "pointer",
                        background: bad ? "color-mix(in oklab, var(--neg) 45%, var(--mid))" : `color-mix(in oklab, var(--pos) ${Math.round(10 + k * 75)}%, var(--mid))`,
                        color: k > 0.6 && !bad ? "#fff" : "var(--ink)",
                      }}>
                      {M.fmt(v)}
                    </button>
                  );
                }),
              ])}
            </div>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            Outlined cell = your current settings. Darker blue = better {M.label.toLowerCase()}. Click any cell to load those settings into step 2.
            {best && <> Best here: <b>{ra.fmt(best.a)}</b> × <b>{rb.fmt(best.b)}</b> ({M.fmt(best[metric] as number)}). Be wary if it&apos;s an isolated peak: that&apos;s often luck, not edge.</>}
          </p>
        </div>
      )}
    </div>
  );
}
