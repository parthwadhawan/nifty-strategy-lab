"use client";
import { Fragment, useMemo, useState } from "react";
import type { BacktestResult, CycleResult, StrategySpec } from "@/lib/types";
import type { Metrics, RegimeRow } from "@/lib/metrics";
import { dateLabel, num, pct, rupees, weekday } from "@/lib/format";
import { DivBar, DrawdownChart, EquityChart, Histogram, MonthlyHeatmap, MoveScatter } from "./Charts";

export interface Analysis {
  headline: string;
  verdict: string;
  grade: string;
  works: string[];
  fails: string[];
  gaps: string[];
  suggestions: { title: string; why: string; patch: any }[];
  model?: string;
}

export interface Comparison {
  title: string;
  spec: StrategySpec;
  m: Metrics;
}

function Kpi({ l, v, h, bad }: { l: string; v: string; h?: string; bad?: boolean }) {
  return (
    <div className={`kpi ${bad ? "bad" : ""}`}>
      <div className="l">{l}</div>
      <div className="v">{v}</div>
      {h && <div className="h">{h}</div>}
    </div>
  );
}

const gradeColor: Record<string, string> = { A: "#0ca30c", B: "#2a78d6", C: "#c98500", D: "#ec835a", F: "#d03b3b" };

export default function Report(props: {
  res: BacktestResult;
  m: Metrics;
  analysis: Analysis | null;
  analyzing: boolean;
  analysisError: string | null;
  aiEnabled: boolean | null;
  onRetryAnalysis: () => void;
  onTest: (s: Analysis["suggestions"][number]) => void;
  testing: string | null;
  comparisons: Comparison[];
  onUse: (spec: StrategySpec) => void;
  onSave: () => void;
}) {
  const { res, m } = props;
  const spec = res.spec;
  const cap = spec.sizing.capital;
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const traded = res.cycles.filter((c) => c.entryDate);
  const worst = useMemo(() => [...traded].sort((a, b) => a.returnPct - b.returnPct).slice(0, 8), [res]);
  const goalYear = spec.weeklyTargetPct * 52;

  const pick = (c: CycleResult) => {
    setOpenWeek(c.expiry);
    setShowAll(true);
    setTimeout(() => document.getElementById(`wk-${c.expiry}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  return (
    <div>
      {/* ---------- Hero ---------- */}
      <div className="card">
        <div className="hero">
          <div>
            <div className="small muted">{spec.name} · {dateLabel(res.start)} – {dateLabel(res.end)} · {m.years.toFixed(1)} years</div>
            <div style={{ margin: "10px 0 2px", color: "var(--ink-2)" }}>{rupees(cap, true)} would have become</div>
            <div className="hero-num">{rupees(cap + m.totalPnl, true)}</div>
            <div style={{ marginTop: 6, fontSize: 15 }}>
              <b className={m.totalPnl >= 0 ? "pos" : "neg"}>{rupees(m.totalPnl, true)}</b> profit after all charges ·{" "}
              <b>{pct(m.cagr, 1)}</b> a year
            </div>
            <div className="row" style={{ marginTop: 14, gap: 8 }}>
              <span className="pill">Nifty buy &amp; hold: {pct(m.benchmarkCagr, 1)}/yr</span>
              <span className="pill">Fixed deposit: ~7%/yr</span>
              <span className="pill">Your goal: {pct(goalYear, 0)}/yr ({spec.weeklyTargetPct}%/week)</span>
            </div>
            <div className={`callout ${m.avgWeeklyPct >= spec.weeklyTargetPct ? "" : "warn"}`} style={{ marginTop: 14 }}>
              <b>Goal check:</b> the {spec.weeklyTargetPct}% weekly goal was met in <b>{pct(m.targetHitAllPct, 0)}</b> of weeks.
              The average week made <b>{pct(m.avgWeeklyPct, 2, true)}</b>, and the worst week lost <b className="neg">{pct(m.worstWeekPct, 2)}</b> ({rupees(m.worstWeekPct / 100 * cap, true)}).
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <AiVerdict {...props} />
            <div className="row">
              <button className="btn" onClick={props.onSave}>☆ Save to library</button>
              <button className="btn" onClick={() => window.print()}>Print / PDF</button>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- KPIs ---------- */}
      <div className="card">
        <h2>The numbers that matter</h2>
        <p className="sub">Percentages are of your starting capital ({rupees(cap, true)}). Every number includes brokerage, STT, exchange fees, GST, stamp duty and {spec.costs.slippagePct}% slippage.</p>
        <div className="kpi-section">Returns</div>
        <div className="kpis">
          <Kpi l="Total profit" v={rupees(m.totalPnl, true)} h={`${pct(m.totalReturnPct, 1, true)} on capital`} bad={m.totalPnl < 0} />
          <Kpi l="Yearly return (CAGR)" v={pct(m.cagr, 1)} h={`Nifty did ${pct(m.benchmarkCagr, 1)}`} bad={m.cagr < 0} />
          <Kpi l="Average week" v={pct(m.avgWeeklyPct, 2, true)} h={`Median ${pct(m.medianWeeklyPct, 2, true)}`} />
          <Kpi l="Return on margin" v={pct(m.romAnnualPct, 1)} h={`Yearly, on ~${rupees(m.avgMargin, true)} margin used`} />
          <Kpi l="After tax" v={rupees(m.postTaxPnl, true)} h={`At ${spec.costs.taxRatePct}% slab (business income)`} />
        </div>
        <div className="kpi-section">Risk: how bad did it get?</div>
        <div className="kpis">
          <Kpi l="Biggest fall from a high" v={pct(m.maxDDPct, 1)} h={`${rupees(m.maxDDRupees, true)} · ${dateLabel(m.maxDDStart)} → ${dateLabel(m.maxDDTrough)}`} bad />
          <Kpi l="Recovered by" v={m.maxDDRecovery ? dateLabel(m.maxDDRecovery) : "Not yet"} h={`Longest time below a high: ${m.longestUnderwaterDays} days`} />
          <Kpi l="Worst week" v={pct(m.worstWeekPct, 2)} h={m.worstWeek ? `Week to ${dateLabel(m.worstWeek.expiry)}` : ""} bad />
          <Kpi l="Worst single day" v={pct(m.worstDayPct, 2)} h={m.worstDayDate ? dateLabel(m.worstDayDate) : ""} bad />
          <Kpi l="Average of worst 5% weeks" v={pct(m.cvar5Pct, 2)} h="What a really bad week looks like" bad />
          <Kpi l="Weeks to earn back worst week" v={m.weeksToRecoverWorst === null ? "Never" : `${m.weeksToRecoverWorst}`} h="Typical weeks needed to repair it" />
        </div>
        <div className="kpi-section">Consistency</div>
        <div className="kpis">
          <Kpi l="Winning weeks" v={pct(m.winRate, 0)} h={`${m.traded} weeks traded, ${m.skipped} skipped`} />
          <Kpi l="Average win vs loss" v={`${pct(m.avgWinPct, 2, true)} / ${pct(m.avgLossPct, 2)}`} h={`Need ${pct(m.breakevenWinRate, 0)} wins to break even`} />
          <Kpi l="Profit factor" v={num(m.profitFactor, 2)} h="₹ won for every ₹1 lost (above 1.5 is healthy)" />
          <Kpi l="Longest losing streak" v={`${m.longestLosingStreak} weeks`} h={`Longest winning streak: ${m.longestWinningStreak}`} />
          <Kpi l="Sharpe ratio" v={num(m.sharpe, 2)} h="Return per unit of risk, after a 6.5% risk-free rate (above 1 is good)" />
          <Kpi l="Sortino / Calmar" v={`${num(m.sortino, 2)} / ${num(m.calmar, 2)}`} h="Downside-risk and drawdown-adjusted return" />
        </div>
        <div className="kpi-section">Strategy mechanics</div>
        <div className="kpis">
          <Kpi l="Premium collected" v={rupees(m.premiumCollected, true)} h={`Kept ${pct(m.captureRatio, 0)} of it as profit`} />
          <Kpi l="Adjustments made" v={`${m.totalAdjustments}`} h={`In ${m.adjustedCycles} weeks; those weeks averaged ${pct(m.adjustedAvgPct, 2, true)}`} />
          <Kpi l="Rolls that couldn't recover the loss" v={`${m.uncoveredAdjustments}`} h="No comfortable strike paid enough" bad={m.uncoveredAdjustments > 0} />
          <Kpi l="Weeks a strike was touched" v={`${m.touchedCycles}`} h={`${pct(m.touchedCycles / Math.max(m.traded, 1) * 100, 0)} of weeks`} />
          <Kpi l="Charges paid" v={rupees(m.totalCosts, true)} h={`${pct(m.costDragPct, 0)} of gross profit`} />
          <Kpi l="Lots per trade" v={num(m.avgLots, 1)} h={`Margin estimate ${spec.sizing.marginPctOfNotional}% of notional`} />
        </div>
      </div>

      {/* ---------- Equity ---------- */}
      <div className="card">
        <h2>How the money grew</h2>
        <p className="sub">Your account balance week by week, against putting the same {rupees(cap, true)} into Nifty on day one.</p>
        <EquityChart res={res} />
        <h3 style={{ marginTop: 18 }}>Falls from the previous high</h3>
        <p className="sub">Each dip is how far the account was below its best level so far. Deep or long dips are the hardest to sit through.</p>
        <DrawdownChart res={res} />
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Big moves hurt</h2>
          <p className="sub">Each dot is a week, placed by how far Nifty swung from your entry. Quiet weeks pay steadily; big swings produce the losses. Click a dot to open that week.</p>
          <MoveScatter res={res} onPick={pick} />
        </div>
        <div className="card">
          <h2>What a typical week looks like</h2>
          <p className="sub">How many weeks ended in each 0.2% band. Green bars met the {spec.weeklyTargetPct}% goal; red bars lost money. Everything worse than −3% sits in the first bar.</p>
          <Histogram m={m} target={spec.weeklyTargetPct} />
          <p className="small muted" style={{ margin: "6px 0 0" }}>Skew {num(m.skew, 2)}: {m.skew < -0.5 ? "many small wins and a few large losses, typical of option selling." : "losses and wins are fairly balanced."}</p>
        </div>
      </div>

      <div className="card">
        <h2>Month by month</h2>
        <p className="sub">Return in each month as % of capital. Blue = profit, red = loss.</p>
        <MonthlyHeatmap m={m} />
      </div>

      {/* ---------- Regimes ---------- */}
      <div className="card">
        <h2>Where it works and where it struggles</h2>
        <p className="sub">The same weeks, grouped by market conditions at entry.</p>
        <div className="grid2">
          <RegimeTable title="By fear level (India VIX at entry)" rows={m.regimes.vix} />
          <RegimeTable title="By how far Nifty travelled during the week" rows={m.regimes.move} />
          <RegimeTable title="By trend (Nifty vs its 50-day average)" rows={m.regimes.trend} />
          <RegimeTable title="Gap weeks vs normal weeks" rows={m.regimes.gap} />
          <RegimeTable title="By expiry day" rows={m.regimes.expiryDay} />
          <RegimeTable title="By year" rows={m.regimes.year} />
        </div>
      </div>

      {/* ---------- Stress ---------- */}
      <div className="grid2">
        <div className="card">
          <h2>The worst weeks</h2>
          <p className="sub">What went wrong and what was happening in the market.</p>
          <div className="tscroll">
            <table className="t">
              <thead><tr><th>Week to</th><th className="n">Result</th><th className="n">Nifty</th><th>What happened</th></tr></thead>
              <tbody>
                {worst.map((c) => (
                  <tr key={c.expiry} className="click" onClick={() => pick(c)}>
                    <td>{dateLabel(c.expiry)}</td>
                    <td className="n neg">{pct(c.returnPct, 2)}</td>
                    <td className="n">{pct(c.niftyMovePct, 1, true)}</td>
                    <td>
                      {c.events.map((e) => <span key={e} className="tag crit">{e}</span>)}
                      {c.adjustments.length > 0 && <span className="tag warn">{c.adjustments.length} adj.</span>}
                      <span className="small muted">VIX {c.vixEntry.toFixed(1)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Biggest overnight gaps</h2>
          <p className="sub">Gaps happen when markets are closed, so nobody can react. These are the days that test a seller most.</p>
          <div className="tscroll">
            <table className="t">
              <thead><tr><th>Date</th><th className="n">Gap</th><th className="n">That week</th><th>Adjusted?</th></tr></thead>
              <tbody>
                {m.gapDays.slice(0, 10).map((g) => (
                  <tr key={g.d}>
                    <td>{weekday(g.d)} {dateLabel(g.d)}</td>
                    <td className={`n ${g.gapPct < 0 ? "neg" : ""}`}>{pct(g.gapPct, 2, true)}</td>
                    <td className={`n ${g.cyclePct !== null && g.cyclePct < 0 ? "neg" : ""}`}>{g.cyclePct === null ? <span className="muted">no position</span> : pct(g.cyclePct, 2, true)}</td>
                    <td>{g.adjusted ? "Yes" : g.cyclePct === null ? "–" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ---------- Monte Carlo ---------- */}
      <div className="card">
        <h2>What could a year look like?</h2>
        <p className="sub">5,000 random years built by reshuffling the actual weekly results. This shows the range of luck, not a forecast.</p>
        <div className="kpis">
          <Kpi l="Bad year (1 in 20)" v={pct(m.monteCarlo.p5, 1, true)} bad={m.monteCarlo.p5 < 0} />
          <Kpi l="Below-average year (1 in 4)" v={pct(m.monteCarlo.p25, 1, true)} />
          <Kpi l="Typical year" v={pct(m.monteCarlo.p50, 1, true)} />
          <Kpi l="Good year (1 in 4)" v={pct(m.monteCarlo.p75, 1, true)} />
          <Kpi l="Chance of a losing year" v={pct(m.monteCarlo.probLossYear, 0)} />
          <Kpi l={`Chance of hitting ${pct(goalYear, 0)} in a year`} v={pct(m.monteCarlo.probHitTarget, 0)} />
          <Kpi l="Chance of a 10%+ fall" v={pct(m.monteCarlo.probDD10, 0)} h={`5%+ fall: ${pct(m.monteCarlo.probDD5, 0)} · 20%+ fall: ${pct(m.monteCarlo.probDD20, 0)}`} />
        </div>
      </div>

      {/* ---------- AI deep dive ---------- */}
      {props.analysis && (
        <div className="card">
          <h2>Claude&apos;s review</h2>
          <p className="sub">Reviewed from the full results above{props.analysis.model ? ` (${props.analysis.model})` : ""}.</p>
          <div className="ai-cols">
            <div><h3>✅ Works when</h3><ul>{props.analysis.works.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            <div><h3>⚠️ Struggles when</h3><ul>{props.analysis.fails.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            <div><h3>🕳️ Gaps in the rules</h3><ul>{props.analysis.gaps.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          </div>
          <h3 style={{ marginTop: 18 }}>Ideas to test: one click each</h3>
          <div className="sugg">
            {props.analysis.suggestions.map((s, i) => (
              <div key={i} className="s">
                <b>{s.title}</b>
                <span className="small" style={{ color: "var(--ink-2)" }}>{s.why}</span>
                <div className="spacer" />
                <button className="btn" onClick={() => props.onTest(s)} disabled={!!props.testing}>
                  {props.testing === s.title ? <><span className="spinner" /> Testing…</> : props.comparisons.some((c) => c.title === s.title) ? "Tested ✓ (see below)" : "Test this →"}
                </button>
              </div>
            ))}
          </div>
          {props.comparisons.length > 0 && (
            <div className="tscroll" style={{ marginTop: 16 }}>
              <table className="t">
                <thead><tr><th>Version</th><th className="n">Yearly return</th><th className="n">Biggest fall</th><th className="n">Worst week</th><th className="n">Goal-weeks</th><th className="n">Win rate</th><th className="n">Profit</th><th /></tr></thead>
                <tbody>
                  <tr><td><b>Your rules</b></td><td className="n">{pct(m.cagr, 1)}</td><td className="n neg">{pct(m.maxDDPct, 1)}</td><td className="n neg">{pct(m.worstWeekPct, 2)}</td><td className="n">{pct(m.targetHitAllPct, 0)}</td><td className="n">{pct(m.winRate, 0)}</td><td className="n">{rupees(m.totalPnl, true)}</td><td /></tr>
                  {props.comparisons.map((c) => (
                    <tr key={c.title}>
                      <td>{c.title}</td>
                      <td className={`n ${c.m.cagr > m.cagr ? "pos" : ""}`}>{pct(c.m.cagr, 1)}</td>
                      <td className={`n ${c.m.maxDDPct > m.maxDDPct ? "pos" : "neg"}`}>{pct(c.m.maxDDPct, 1)}</td>
                      <td className={`n ${c.m.worstWeekPct > m.worstWeekPct ? "pos" : "neg"}`}>{pct(c.m.worstWeekPct, 2)}</td>
                      <td className="n">{pct(c.m.targetHitAllPct, 0)}</td>
                      <td className="n">{pct(c.m.winRate, 0)}</td>
                      <td className="n">{rupees(c.m.totalPnl, true)}</td>
                      <td><button className="btn ghost" onClick={() => props.onUse(c.spec)}>Use this</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted">Blue means better than your current rules. &quot;Use this&quot; loads that version into step 2 so you can run the full report.</p>
            </div>
          )}
        </div>
      )}

      {/* ---------- Trade log ---------- */}
      <div className="card">
        <div className="row">
          <div>
            <h2>Every week</h2>
            <p className="sub" style={{ margin: 0 }}>Click a week to see each order: strike, price and date.</p>
          </div>
          <div className="spacer" />
          <button className="btn" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${res.cycles.length} weeks`}</button>
          <button className="btn" onClick={() => downloadCsv(res)}>Download CSV</button>
        </div>
        <div className="tscroll" style={{ marginTop: 12 }}>
          <table className="t">
            <thead>
              <tr><th>Expiry</th><th>Entered</th><th className="n">Lots</th><th className="n">Put / Call sold</th><th className="n">Premium</th><th className="n">P&amp;L</th><th className="n">%</th><th className="n">Nifty</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {(showAll ? [...res.cycles].reverse() : [...res.cycles].reverse().slice(0, 12)).map((c) => (
                <Fragment key={c.expiry}>
                  <tr id={`wk-${c.expiry}`} className="click" onClick={() => setOpenWeek(openWeek === c.expiry ? null : c.expiry)}>
                    <td>{weekday(c.expiry)} {dateLabel(c.expiry)}</td>
                    <td>{c.entryDate ? `${weekday(c.entryDate)} ${dateLabel(c.entryDate, false)}` : <span className="muted">skipped</span>}</td>
                    <td className="n">{c.entryDate ? `${c.lots} × ${c.lotSize}` : "–"}</td>
                    <td className="n">{c.initialPE ? `${c.initialPE} / ${c.initialCE}` : "–"}</td>
                    <td className="n">{c.entryDate ? rupees(c.premiumCollected, true) : "–"}</td>
                    <td className={`n ${c.netPnl < 0 ? "neg" : ""}`}>{c.entryDate ? rupees(c.netPnl, true) : "–"}</td>
                    <td className={`n ${c.returnPct < 0 ? "neg" : ""}`}>{c.entryDate ? pct(c.returnPct, 2, true) : "–"}</td>
                    <td className="n">{pct(c.niftyMovePct, 1, true)}</td>
                    <td>
                      {c.adjustments.length > 0 && <span className="tag warn">{c.adjustments.length} adj.</span>}
                      {c.touchedStrike && <span className="tag crit">strike touched</span>}
                      {c.skipped && <span className="tag">{c.skipped}</span>}
                      {c.events.slice(0, 1).map((e) => <span key={e} className="tag">{e}</span>)}
                    </td>
                  </tr>
                  {openWeek === c.expiry && (
                    <tr><td colSpan={9} style={{ background: "var(--page)" }}><WeekDetail c={c} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <footer>
        <b>About this test.</b> Data: NSE daily F&amp;O bhavcopy (open, high, low, close for every Nifty option) and NSE index closes, {dateLabel(res.start)} to {dateLabel(res.end)}.
        Entries at 9:16 use each option&apos;s opening price; exits use the closing price. Lot sizes, the Thursday-to-Tuesday expiry change and STT changes (Oct 2024, Apr 2026) are applied by date.
        {res.warnings.map((w) => <span key={w}> {w}</span>)} Margin is an estimate. A backtest shows what would have happened, not what will happen. This is not investment advice.
      </footer>
    </div>
  );
}

function quickRead(m: Metrics, spec: StrategySpec) {
  const avgWin = Math.max(m.avgWeeklyPct, 0.01);
  const weeksLost = Math.abs(m.worstWeekPct) / avgWin;
  const w = m.worstWeek;
  const headline = m.worstWeekPct < -3 * Math.max(m.avgWinPct, 0.1)
    ? `Wins ${m.winRate.toFixed(0)}% of weeks, but one bad week${w ? ` (to ${dateLabel(w.expiry)})` : ""} wiped out about ${Math.round(weeksLost)} average weeks of profit.`
    : `Wins ${m.winRate.toFixed(0)}% of weeks and losses stay contained: the worst week was ${pct(m.worstWeekPct, 1)}.`;
  const points = [
    `${pct(m.cagr, 1)} a year vs ${pct(m.benchmarkCagr, 1)} for Nifty and ~7% for a fixed deposit.`,
    `The ${spec.weeklyTargetPct}% weekly goal was met in ${pct(m.targetHitAllPct, 0)} of weeks; the average week made ${pct(m.avgWeeklyPct, 2, true)}.`,
    `The deepest fall was ${pct(m.maxDDPct, 1)} of capital${m.maxDDRecovery ? `, recovered by ${dateLabel(m.maxDDRecovery)}` : " and it hasn't fully recovered yet"}.`,
  ];
  return { headline, points };
}

function AiVerdict(props: { analysis: Analysis | null; analyzing: boolean; analysisError: string | null; aiEnabled: boolean | null; onRetryAnalysis: () => void; m: Metrics; res: BacktestResult }) {
  if (props.analysis) {
    const a = props.analysis;
    return (
      <div className="callout" style={{ flex: 1 }}>
        <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
          <div className="grade" style={{ background: gradeColor[a.grade] ?? "#2a78d6" }}>{a.grade}</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16, lineHeight: 1.35 }}>{a.headline}</div>
            <div style={{ marginTop: 6, fontSize: 14, color: "var(--ink-2)" }}>{a.verdict}</div>
          </div>
        </div>
      </div>
    );
  }
  const q = quickRead(props.m, props.res.spec);
  return (
    <div className="callout" style={{ flex: 1 }}>
      <div className="small muted" style={{ marginBottom: 4 }}>Quick read</div>
      <div style={{ fontWeight: 600, fontSize: 16, lineHeight: 1.35 }}>{q.headline}</div>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 14, color: "var(--ink-2)" }}>{q.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
      <div className="small" style={{ marginTop: 10 }}>
        {props.analyzing && <><span className="spinner" /> Claude is reviewing every week, the worst periods and a 25-run parameter scan…</>}
        {!props.analyzing && props.aiEnabled === false && <span className="muted">Add an Anthropic API key to get Claude&apos;s written review and one-click improvement ideas.</span>}
        {!props.analyzing && props.analysisError && <span className="neg">The AI review failed: {props.analysisError} <button className="btn ghost" onClick={props.onRetryAnalysis}>Try again</button></span>}
      </div>
    </div>
  );
}

function RegimeTable({ title, rows }: { title: string; rows: RegimeRow[] }) {
  const max = Math.max(0.01, ...rows.map((r) => Math.abs(r.avgRet)));
  return (
    <div>
      <h3>{title}</h3>
      <div className="tscroll">
        <table className="t">
          <thead><tr><th /><th className="n">Weeks</th><th className="n">Won</th><th className="n">Avg week</th><th style={{ width: 110 }} /><th className="n">Worst</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="n">{r.traded}</td>
                <td className="n">{pct(r.winRate, 0)}</td>
                <td className={`n ${r.avgRet < 0 ? "neg" : ""}`}>{pct(r.avgRet, 2, true)}</td>
                <td><DivBar v={r.avgRet} max={max} /></td>
                <td className="n neg">{pct(r.worst, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WeekDetail({ c }: { c: CycleResult }) {
  return (
    <div style={{ padding: "6px 4px" }}>
      <div className="small" style={{ marginBottom: 8 }}>
        Nifty at entry {c.spotEntry.toFixed(0)} → {c.spotExit.toFixed(0)} at exit (widest swing {pct(c.niftyRangePct, 1)}). VIX {c.vixEntry.toFixed(1)}.
        Closest Nifty came to a short strike: {pct(c.closestApproachPct, 2)}. {c.exitReason && `Exit: ${c.exitReason}.`} Charges {rupees(c.costs)}.
      </div>
      {c.adjustments.map((a, i) => (
        <div key={i} className="small" style={{ marginBottom: 4 }}>
          <span className="tag warn">Adjustment {i + 1}</span>{dateLabel(a.date)}: {a.reason}. Booked so far {rupees(a.realizedSoFar)}.
          {a.newPE && ` Re-sold ${a.newPE} PE / ${a.newCE} CE${a.covered === false ? " (couldn't collect enough to cover the loss)" : ""}.`}
        </div>
      ))}
      <div className="legs" style={{ marginTop: 8 }}>
        {c.legs.map((l, i) => {
          const pnl = (l.side === "sell" ? l.entryPrice - (l.exitPrice ?? 0) : (l.exitPrice ?? 0) - l.entryPrice) * l.qty;
          return (
            <div key={i}>
              {l.side === "sell" ? "SELL" : "BUY"} {l.strike} {l.type} × {l.qty} · {weekday(l.entryDate)} {dateLabel(l.entryDate, false)} @ ₹{l.entryPrice.toFixed(2)} → {l.exitDate ? `${weekday(l.exitDate)} ${dateLabel(l.exitDate, false)} @ ₹${l.exitPrice?.toFixed(2)}` : "open"}
              {" "}<span className={pnl < 0 ? "neg" : "pos"}>{rupees(pnl)}</span>{l.estimated ? <span className="muted"> (price estimated)</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function downloadCsv(res: BacktestResult) {
  const rows = [["expiry", "entry", "exit", "lots", "lot_size", "put_sold", "call_sold", "premium", "gross_pnl", "charges", "net_pnl", "return_pct", "nifty_move_pct", "vix", "adjustments", "exit_reason", "events"]];
  for (const c of res.cycles) {
    rows.push([c.expiry, c.entryDate ?? "", c.exitDate, String(c.lots), String(c.lotSize), String(c.initialPE ?? ""), String(c.initialCE ?? ""),
      c.premiumCollected.toFixed(0), c.grossPnl.toFixed(0), c.costs.toFixed(0), c.netPnl.toFixed(0), c.returnPct.toFixed(3), c.niftyMovePct.toFixed(2),
      c.vixEntry.toFixed(2), String(c.adjustments.length), c.exitReason || c.skipped || "", c.events.join("; ")]);
  }
  const csv = rows.map((r) => r.map((x) => (/[",]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `${res.spec.name.replace(/[^a-z0-9]+/gi, "-")}-weeks.csv`;
  a.click();
}
