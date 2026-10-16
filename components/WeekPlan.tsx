"use client";
import { useState } from "react";
import type { Dataset, DayData, StrategySpec } from "@/lib/types";
import { chainFor, marketPricer, runBacktest, selectStrikes } from "@/lib/engine";
import { niftyLotSize } from "@/lib/market";
import { extendDataset } from "@/lib/data";
import { dateLabel, pct, rupees, weekday } from "@/lib/format";

interface Preview { expiry: string; ce: number; pe: number; cePx: number; pePx: number; lots: number; lotSize: number; premium: number; ok: boolean; needPts: number }

function preview(spec: StrategySpec, day: DayData, expiry: string): Preview | null {
  if (!chainFor(day, expiry)) return null;
  const lotSize = niftyLotSize(expiry);
  const spot = day.n[3];
  const lots = spec.sizing.mode === "fixed_lots" ? spec.sizing.lots : Math.max(1, Math.floor(spec.sizing.capital / (spot * lotSize * spec.sizing.marginPctOfNotional / 100)));
  const qty = lots * lotSize;
  const need = (spec.strikes.targetPremiumPct / 100) * spec.sizing.capital / qty;
  const pricer = marketPricer(day, expiry, "c");
  const vix = day.v?.[3] ?? 15;
  const sel = selectStrikes(spec, day, expiry, spot, vix, pricer, need, spec.strikes.minOtmPercent, true);
  if (!sel.ce) return null;
  const cePx = pricer("CE", sel.ce).p, pePx = pricer("PE", sel.pe).p;
  return { expiry, ce: sel.ce, pe: sel.pe, cePx, pePx, lots, lotSize, premium: (cePx + pePx) * qty, ok: sel.covered, needPts: need };
}

export default function WeekPlan(props: { ds: Dataset | null; setDs: (d: Dataset) => void; spec: StrategySpec }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [plan, setPlan] = useState<any>(null);

  const check = async () => {
    if (!props.ds) return;
    setBusy(true); setNote(null);
    let ds = props.ds;
    try {
      const r = await fetch(`/api/latest?since=${ds.days[ds.days.length - 1].d}`);
      const j = await r.json();
      if (j.days?.length) { ds = extendDataset(ds, j.days); props.setDs(ds); setNote(`Fetched ${j.days.length} newer trading day(s) from NSE.`); }
      else setNote("No newer NSE data was available. Using the latest day in the app.");
    } catch {
      setNote("Couldn't reach NSE just now. Using the latest day in the app.");
    }
    const last = ds.days[ds.days.length - 1];
    const from = ds.days[Math.max(0, ds.days.length - 40)].d;
    const res = runBacktest(ds, props.spec, { from, openCycle: true });
    const oc = res.openCycle;
    let next: Preview | null = null;
    if (!oc || oc.state !== "open") {
      // preview the next entry using today's closing prices
      const curDone = oc && oc.state === "done" && oc.expiry === last.x[0]?.e;
      const exp = last.x[0]?.e === last.d || curDone ? last.x[1]?.e : last.x[0]?.e;
      if (exp) next = preview(props.spec, last, exp);
    }
    const lastClosed = [...res.cycles].reverse().find((c) => c.entryDate);
    setPlan({ last, oc, next, lastClosed });
    setBusy(false);
  };

  const s = props.spec;
  return (
    <div className="card">
      <h2>This week&apos;s plan</h2>
      <p className="sub">Applies <b>{s.name}</b> to the latest market data: what you&apos;d be holding now, the levels that would trigger an adjustment, and what the next entry would look like. It only runs when you press the button. Nothing runs in the background.</p>
      <button className="btn primary" onClick={check} disabled={busy || !props.ds}>{busy ? <><span className="spinner" /> Checking NSE…</> : "Check this week →"}</button>
      {note && <p className="small muted" style={{ marginTop: 8 }}>{note}</p>}

      {plan && (
        <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="pill">Data as of {weekday(plan.last.d)} {dateLabel(plan.last.d)} close</span>
            <span className="pill">Nifty {plan.last.n[3].toLocaleString("en-IN")}</span>
            {plan.last.v && <span className="pill">India VIX {plan.last.v[3].toFixed(2)}</span>}
          </div>

          {plan.oc?.state === "open" && plan.oc.openLegs.length > 0 && (() => {
            const oc = plan.oc;
            const ce = oc.openLegs.find((l: any) => l.type === "CE" && l.side === "sell");
            const pe = oc.openLegs.find((l: any) => l.type === "PE" && l.side === "sell");
            const close = plan.last.n[3];
            const g = s.risk.gapAdjustPct, b = s.risk.breachBufferPct;
            const pr = marketPricer(plan.last, oc.expiry, "c");
            return (
              <div className="callout">
                <h3 style={{ margin: "0 0 6px" }}>You&apos;d be holding: week to {weekday(oc.expiry)} {dateLabel(oc.expiry)}</h3>
                <div className="legs">
                  {oc.openLegs.map((l: any, i: number) => (
                    <div key={i}>{l.side === "sell" ? "SOLD" : "BOUGHT"} {l.strike} {l.type} × {l.qty} on {dateLabel(l.entryDate, false)} @ ₹{l.entryPrice.toFixed(2)} · now ₹{pr(l.type, l.strike).p.toFixed(2)}</div>
                  ))}
                </div>
                <p style={{ margin: "10px 0 0" }}>P&amp;L so far this week: <b className={oc.netSoFar < 0 ? "neg" : "pos"}>{rupees(oc.netSoFar)}</b> ({pct(oc.netSoFar / s.sizing.capital * 100, 2, true)}). {oc.adjustments.length > 0 && `${oc.adjustments.length} adjustment(s) made.`} {oc.sessionsLeft} session(s) until exit.</p>
                <h3 style={{ margin: "12px 0 6px" }}>Adjustment triggers for the next session</h3>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {g > 0 && <li>Gap rule: Nifty opens above <b>{Math.round(close * (1 + g / 100)).toLocaleString("en-IN")}</b> or below <b>{Math.round(close * (1 - g / 100)).toLocaleString("en-IN")}</b> ({g}% from today&apos;s close).</li>}
                  {b >= 0 && ce && pe && <li>Strike rule: Nifty touches <b>{Math.round(ce.strike * (1 - b / 100)).toLocaleString("en-IN")}</b> (near the {ce.strike} call) or <b>{Math.round(pe.strike * (1 + b / 100)).toLocaleString("en-IN")}</b> (near the {pe.strike} put).</li>}
                  {s.risk.stopLossPctOfCapital > 0 && <li>Stop-loss: weekly loss reaches {rupees(s.sizing.capital * s.risk.stopLossPctOfCapital / 100)}.</li>}
                </ul>
              </div>
            );
          })()}

          {plan.oc?.state === "done" && plan.oc.cycle?.entryDate && (
            <div className="callout">This week&apos;s trade (expiry {dateLabel(plan.oc.expiry)}) is already closed: {plan.oc.cycle.exitReason || "done"}. Result: <b className={plan.oc.netSoFar < 0 ? "neg" : "pos"}>{rupees(plan.oc.netSoFar)}</b> ({pct(plan.oc.netSoFar / s.sizing.capital * 100, 2, true)}).</div>
          )}
          {plan.oc?.state === "waiting" && <div className="callout warn">The strategy is waiting to enter this week{plan.oc.cycle?.skipped ? `: ${plan.oc.cycle.skipped}` : ""}.</div>}

          {plan.next && (
            <div className="callout">
              <h3 style={{ margin: "0 0 6px" }}>Next entry preview (week to {weekday(plan.next.expiry)} {dateLabel(plan.next.expiry)})</h3>
              <p style={{ margin: 0 }}>Using {dateLabel(plan.last.d)} closing prices, the rules would sell <b>{plan.next.pe} PE</b> (₹{plan.next.pePx.toFixed(2)}) and <b>{plan.next.ce} CE</b> (₹{plan.next.cePx.toFixed(2)}) × {plan.next.lots} lots of {plan.next.lotSize}, collecting about <b>{rupees(plan.next.premium)}</b>{" "}
                (target {rupees(s.strikes.targetPremiumPct / 100 * s.sizing.capital)}).</p>
              {!plan.next.ok && <p className="small" style={{ margin: "6px 0 0" }}>⚠️ At the comfort floor ({s.strikes.minOtmPercent}%), premium is below target right now. The rules would wait a day.</p>}
              <p className="small muted" style={{ margin: "6px 0 0" }}>Real prices at 9:16 on entry day will differ{plan.next.expiry !== plan.last.x[0]?.e ? ", and premiums shrink as expiry gets closer, so strikes will likely be a little nearer" : ""}. Use this as a guide, not an order.</p>
            </div>
          )}

          {plan.lastClosed && (
            <p className="small muted">Last completed week (to {dateLabel(plan.lastClosed.expiry)}): {pct(plan.lastClosed.returnPct, 2, true)} ({rupees(plan.lastClosed.netPnl)}).</p>
          )}
        </div>
      )}
    </div>
  );
}
