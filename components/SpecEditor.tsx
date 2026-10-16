"use client";
import type { StrategySpec } from "@/lib/types";

export interface Interpretation {
  understanding: string[];
  assumptions: string[];
  questions: string[];
  unsupported: string[];
  model?: string;
}

type Path = string; // "risk.gapAdjustPct"

function get(spec: any, path: Path) {
  return path.split(".").reduce((o, k) => o?.[k], spec);
}
function set(spec: StrategySpec, path: Path, v: unknown): StrategySpec {
  const s: any = structuredClone(spec);
  const ks = path.split(".");
  let o = s;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = v;
  return s;
}

export default function SpecEditor(props: {
  spec: StrategySpec;
  setSpec: (s: StrategySpec) => void;
  interp: Interpretation | null;
  period: string;
  setPeriod: (p: string) => void;
  onRun: () => void;
  running: boolean;
  dataReady: boolean;
  dataRange: string;
}) {
  const { spec, setSpec } = props;
  const N = (p: { path: Path; label: string; step?: number; hint?: string; prefix?: string }) => (
    <div className="field">
      <label htmlFor={p.path}>{p.label}</label>
      <input id={p.path} type="number" step={p.step ?? 0.1} value={get(spec, p.path)}
        onChange={(e) => setSpec(set(spec, p.path, e.target.value === "" ? 0 : Number(e.target.value)))} />
      {p.hint && <span className="small muted">{p.hint}</span>}
    </div>
  );
  const S = (p: { path: Path; label: string; options: [string | number, string][]; numeric?: boolean }) => (
    <div className="field">
      <label htmlFor={p.path}>{p.label}</label>
      <select id={p.path} value={String(get(spec, p.path))}
        onChange={(e) => setSpec(set(spec, p.path, p.numeric ? Number(e.target.value) : e.target.value))}>
        {p.options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
      </select>
    </div>
  );
  const C = (p: { path: Path; label: string }) => (
    <div className="field inline">
      <label htmlFor={p.path}>{p.label}</label>
      <input id={p.path} type="checkbox" checked={!!get(spec, p.path)} onChange={(e) => setSpec(set(spec, p.path, e.target.checked))} />
    </div>
  );

  const it = props.interp;
  return (
    <div className="card">
      <h2><span className="step">2</span>Here&apos;s what I understood</h2>
      <p className="sub">Check these rules before running. Change any number below and it&apos;ll be used exactly as shown.</p>

      {it ? (
        <>
          <ul className="understood">{it.understanding.map((u, i) => <li key={i}>{u}</li>)}</ul>
          {(it.assumptions.length > 0 || it.questions.length > 0) && (
            <div className="assume">
              {it.assumptions.length > 0 && (<><b>Where you weren&apos;t specific, I assumed:</b><ul>{it.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></>)}
              {it.questions.length > 0 && (<div style={{ marginTop: 8 }}><b>Worth deciding:</b><ul>{it.questions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>)}
            </div>
          )}
          {it.unsupported.length > 0 && (
            <div className="callout" style={{ marginTop: 12, fontSize: 13.5 }}>
              <b>How daily data handles this:</b>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{it.unsupported.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}
        </>
      ) : (
        <div className="callout" style={{ fontSize: 14 }}>Describe a strategy above and I&apos;ll fill in these rules. Or set them by hand.</div>
      )}

      <div style={{ marginTop: 18 }} className="field">
        <label htmlFor="name">Strategy name</label>
        <input id="name" value={spec.name} onChange={(e) => setSpec({ ...spec, name: e.target.value })} />
      </div>

      <div className="form-grid">
        <div className="group">
          <h4>Money</h4>
          {N({ path: "sizing.capital", label: "Capital (₹)", step: 50000 })}
          {S({ path: "sizing.mode", label: "Position size", options: [["auto_capital", "As many lots as my capital allows"], ["fixed_lots", "Fixed number of lots"]] })}
          {spec.sizing.mode === "fixed_lots" && N({ path: "sizing.lots", label: "Lots", step: 1 })}
          {N({ path: "sizing.marginPctOfNotional", label: "Margin per lot (% of Nifty × lot size)", hint: "≈9% for a naked strangle; your broker's margin calculator gives the exact figure" })}
          {N({ path: "weeklyTargetPct", label: "My weekly goal (%)", step: 0.05 })}
        </div>
        <div className="group">
          <h4>Entry</h4>
          {S({ path: "structure", label: "Position", options: [["strangle", "Short strangle (sell OTM call + put)"], ["straddle", "Short straddle (sell ATM call + put)"], ["iron_condor", "Iron condor (strangle + bought hedges)"]] })}
          {S({ path: "entry.daysAfterExpiry", label: "Entry day", numeric: true, options: [[0, "On expiry day (next week's contract)"], [1, "1st session after expiry (Wed today)"], [2, "2nd session after expiry"], [3, "3rd session after expiry"]] })}
          {S({ path: "entry.entryPrice", label: "Entry time", options: [["open", "Morning (9:16 open)"], ["close", "Afternoon (3:25 close)"]] })}
          {C({ path: "entry.retryIfPremiumShort", label: "If premium is too low, try again next day" })}
        </div>
        <div className="group">
          <h4>Strikes</h4>
          {S({ path: "strikes.method", label: "How to choose strikes", options: [["target_premium", "Farthest strikes that give my premium target"], ["otm_percent", "Fixed % away from Nifty"], ["sd_move", "Based on expected move (India VIX)"]] })}
          {spec.strikes.method === "target_premium" && N({ path: "strikes.targetPremiumPct", label: "Premium to collect per week (% of capital)", step: 0.05, hint: `≈ ${(spec.strikes.targetPremiumPct / 100 * spec.sizing.capital).toLocaleString("en-IN")} ₹ per full week` })}
          {spec.strikes.method === "otm_percent" && N({ path: "strikes.otmPercent", label: "Distance from Nifty (%)" })}
          {spec.strikes.method === "sd_move" && N({ path: "strikes.sdMultiple", label: "Multiple of expected move" })}
          {N({ path: "strikes.minOtmPercent", label: "Comfort floor: never closer than (%)", hint: "Strikes nearer than this are never sold" })}
          {C({ path: "wings.enabled", label: "Buy protective hedges (wings)" })}
          {spec.wings.enabled && N({ path: "wings.distancePercent", label: "Hedge distance beyond short strike (%)" })}
        </div>
        <div className="group">
          <h4>Adjustments</h4>
          {N({ path: "risk.gapAdjustPct", label: "Adjust if Nifty gaps by (%)", hint: "0 = ignore gaps" })}
          {N({ path: "risk.breachBufferPct", label: "Adjust when Nifty comes within (%) of a strike", hint: "−1 = never" })}
          {S({ path: "intradayFill", label: "Watch for that", options: [["intraday", "All day (automatic, intraday)"], ["close", "Only at 3:30 close"]] })}
          {S({ path: "risk.adjustAction", label: "When triggered", options: [["roll_cover_loss", "Close & open a new strangle that recovers the loss"], ["roll_same", "Close & open a fresh strangle (normal target)"], ["exit", "Close and stay out for the week"]] })}
          {N({ path: "risk.maxAdjustmentsPerCycle", label: "Max adjustments per week", step: 1 })}
          {S({ path: "risk.afterMaxAdjust", label: "After that", options: [["exit", "Exit on the next trigger"], ["hold", "Hold till exit day"]] })}
          {N({ path: "risk.adjustMinOtmPercent", label: "Comfort floor when re-entering (%)" })}
        </div>
        <div className="group">
          <h4>Exit &amp; protection</h4>
          {S({ path: "exit.daysBeforeExpiry", label: "Exit day", numeric: true, options: [[0, "Hold into expiry"], [1, "Session before expiry, 3:30 (Mon today)"], [2, "2 sessions before expiry"]] })}
          {N({ path: "risk.stopLossPctOfCapital", label: "Weekly stop-loss (% of capital)", hint: "0 = none" })}
          {N({ path: "risk.takeProfitPctOfPremium", label: "Book profit at (% of premium decayed)", step: 5, hint: "0 = hold to exit day" })}
        </div>
        <div className="group">
          <h4>Costs &amp; tax</h4>
          {N({ path: "costs.brokeragePerOrder", label: "Brokerage per order (₹)", step: 1 })}
          {N({ path: "costs.slippagePct", label: "Slippage (% of option price)", step: 0.5 })}
          {N({ path: "costs.taxRatePct", label: "Tax slab on F&O profit (%)", step: 1 })}
          <p className="small muted" style={{ margin: 0 }}>STT, exchange fees, GST, SEBI fees and stamp duty are applied automatically at the rates that applied on each date.</p>
        </div>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <div className="field" style={{ margin: 0, minWidth: 200 }}>
          <label htmlFor="period">Test period</label>
          <select id="period" value={props.period} onChange={(e) => props.setPeriod(e.target.value)}>
            <option value="5">Last 5 years</option>
            <option value="3">Last 3 years</option>
            <option value="2">Last 2 years</option>
            <option value="1">Last 1 year</option>
            <option value="tue">Tuesday-expiry era only (Sep 2025 →)</option>
          </select>
        </div>
        <div className="spacer" />
        <span className="small muted">{props.dataRange}</span>
        <button className="btn primary big" onClick={props.onRun} disabled={props.running || !props.dataReady}>
          {props.running ? <><span className="spinner" /> Running…</> : props.dataReady ? "Run backtest →" : <><span className="spinner" /> Loading market data…</>}
        </button>
      </div>
    </div>
  );
}
