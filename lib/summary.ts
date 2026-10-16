import type { BacktestResult } from "./types";
import type { Metrics } from "./metrics";

const r1 = (x: number) => Math.round(x * 100) / 100;

/** Compact, token-friendly summary of a backtest for the AI reviewer */
export function buildSummary(res: BacktestResult, m: Metrics, scan?: unknown) {
  const traded = res.cycles.filter((c) => c.entryDate);
  const worst = [...traded].sort((a, b) => a.returnPct - b.returnPct).slice(0, 8);
  const best = [...traded].sort((a, b) => b.returnPct - a.returnPct).slice(0, 3);
  const cyc = (c: (typeof traded)[number]) => ({
    expiry: c.expiry, entry: c.entryDate, exit: c.exitDate, returnPct: r1(c.returnPct), pnl: Math.round(c.netPnl),
    niftyMovePct: r1(c.niftyMovePct), niftyMaxRangePct: r1(c.niftyRangePct), vixAtEntry: r1(c.vixEntry),
    shortStrikes: [c.initialPE, c.initialCE], spotAtEntry: Math.round(c.spotEntry),
    adjustments: c.adjustments.map((a) => `${a.date}: ${a.reason}${a.covered === false ? " (could not fully cover the loss)" : ""}`),
    exitReason: c.exitReason, events: c.events,
  });
  const reg = (rows: Metrics["regimes"]["vix"]) => rows.map((r) => ({ label: r.label, weeks: r.traded, winRate: r1(r.winRate), avgWeeklyPct: r1(r.avgRet), worstPct: r1(r.worst), pnl: Math.round(r.totalPnl) }));
  return {
    period: `${res.start} to ${res.end}`,
    capital: m.capital,
    headline: {
      totalPnl: Math.round(m.totalPnl), cagrPct: r1(m.cagr), niftyBuyHoldCagrPct: r1(m.benchmarkCagr), fixedDepositPct: 7,
      avgWeeklyPct: r1(m.avgWeeklyPct), weeklyGoalPct: res.spec.weeklyTargetPct, weeksMeetingGoalPct: r1(m.targetHitPct),
      maxDrawdownPct: r1(m.maxDDPct), maxDrawdownFrom: m.maxDDStart, maxDrawdownTrough: m.maxDDTrough, recoveredOn: m.maxDDRecovery,
      longestUnderwaterDays: m.longestUnderwaterDays, sharpe: r1(m.sharpe), sortino: r1(m.sortino), calmar: r1(m.calmar),
      winRatePct: r1(m.winRate), avgWinPct: r1(m.avgWinPct), avgLossPct: r1(m.avgLossPct), breakevenWinRatePct: r1(m.breakevenWinRate),
      profitFactor: r1(m.profitFactor), worstWeekPct: r1(m.worstWeekPct), bestWeekPct: r1(m.bestWeekPct), worst5PctOfWeeksAvg: r1(m.cvar5Pct),
      skew: r1(m.skew), longestLosingStreak: m.longestLosingStreak, weeksToRecoverWorstWeek: m.weeksToRecoverWorst,
      weeksTraded: m.traded, weeksSkipped: m.skipped, adjustments: m.totalAdjustments, weeksWithAdjustments: m.adjustedCycles,
      adjustedWeeksWinRatePct: r1(m.adjustedWinRate), adjustedWeeksAvgPct: r1(m.adjustedAvgPct), adjustmentsThatCouldNotCoverLoss: m.uncoveredAdjustments,
      weeksStrikeTouched: m.touchedCycles, premiumKeptPct: r1(m.captureRatio), costsRupees: Math.round(m.totalCosts), costsAsPctOfGrossProfit: r1(m.costDragPct),
      avgLots: r1(m.avgLots), returnOnMarginAnnualPct: r1(m.romAnnualPct), timeInMarketPct: r1(m.timeInMarketPct),
    },
    monteCarloOneYear: m.monteCarlo,
    regimes: { byVix: reg(m.regimes.vix), byNiftyMove: reg(m.regimes.move), byTrend: reg(m.regimes.trend), byExpiryDay: reg(m.regimes.expiryDay), byYear: reg(m.regimes.year), byGap: reg(m.regimes.gap) },
    worstWeeks: worst.map(cyc),
    bestWeeks: best.map(cyc),
    biggestGapDays: m.gapDays.slice(0, 8).map((g) => ({ date: g.d, gapPct: r1(g.gapPct), strategyWeekPct: g.cyclePct === null ? null : r1(g.cyclePct), adjustedThatDay: g.adjusted })),
    parameterScan: scan ?? null,
    dataNotes: res.warnings,
  };
}
