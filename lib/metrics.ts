import type { BacktestResult, CycleResult, Dataset } from "./types";

export interface RegimeRow {
  label: string;
  cycles: number;
  traded: number;
  winRate: number;
  avgRet: number;
  totalPnl: number;
  worst: number;
}

export interface Metrics {
  capital: number;
  totalPnl: number;
  totalReturnPct: number;
  cagr: number;
  benchmarkCagr: number;
  benchmarkReturnPct: number;
  fdCagr: number;
  years: number;
  avgWeeklyPct: number;
  medianWeeklyPct: number;
  targetHitPct: number; // % of traded weeks ≥ weekly target
  targetHitAllPct: number; // % of all weeks
  maxDDPct: number; // % of capital
  maxDDRupees: number;
  maxDDStart: string;
  maxDDTrough: string;
  maxDDRecovery: string | null;
  longestUnderwaterDays: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  volAnnualPct: number;
  cycles: number;
  traded: number;
  skipped: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  payoff: number;
  breakevenWinRate: number;
  profitFactor: number;
  expectancyRupees: number;
  bestWeekPct: number;
  worstWeekPct: number;
  worstWeek: CycleResult | null;
  worstDayPct: number;
  worstDayDate: string;
  cvar5Pct: number;
  skew: number;
  longestLosingStreak: number;
  longestWinningStreak: number;
  weeksToRecoverWorst: number | null;
  adjustedCycles: number;
  adjustedWinRate: number;
  adjustedAvgPct: number;
  totalAdjustments: number;
  uncoveredAdjustments: number;
  touchedCycles: number;
  premiumCollected: number;
  captureRatio: number;
  totalCosts: number;
  costDragPct: number; // costs as % of gross profit
  avgLots: number;
  avgMargin: number;
  romAnnualPct: number; // return on margin (annualised, simple)
  taxPct: number;
  postTaxPnl: number;
  timeInMarketPct: number;
  regimes: { vix: RegimeRow[]; move: RegimeRow[]; trend: RegimeRow[]; expiryDay: RegimeRow[]; year: RegimeRow[]; gap: RegimeRow[] };
  monthly: { y: number; m: number; pct: number }[];
  histogram: { from: number; to: number; count: number }[];
  drawdowns: { start: string; trough: string; end: string | null; depthPct: number; days: number }[];
  monteCarlo: {
    p5: number; p25: number; p50: number; p75: number; p95: number;
    probLossYear: number; probDD5: number; probDD10: number; probDD20: number; probHitTarget: number;
  };
  gapDays: { d: string; gapPct: number; cycleExpiry: string | null; cyclePct: number | null; adjusted: boolean }[];
}

const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function regime(label: string, cs: CycleResult[]): RegimeRow {
  const tr = cs.filter((c) => c.entryDate);
  return {
    label,
    cycles: cs.length,
    traded: tr.length,
    winRate: pct(tr.filter((c) => c.netPnl > 0).length, tr.length),
    avgRet: mean(tr.map((c) => c.returnPct)),
    totalPnl: tr.reduce((a, c) => a + c.netPnl, 0),
    worst: tr.length ? Math.min(...tr.map((c) => c.returnPct)) : 0,
  };
}

export function computeMetrics(res: BacktestResult, ds: Dataset): Metrics {
  const cap = res.spec.sizing.capital;
  const cycles = res.cycles;
  const traded = cycles.filter((c) => c.entryDate);
  const rets = traded.map((c) => c.returnPct);
  const allRets = cycles.map((c) => c.returnPct);
  const daily = res.daily;
  const last = daily[daily.length - 1];
  const first = daily[0];
  const calDays = (Date.parse(last.d) - Date.parse(first.d)) / 86400000;
  const years = Math.max(calDays / 365.25, 0.01);
  const totalPnl = last.equity - cap;
  const cagr = (Math.pow(Math.max(last.equity, 1) / cap, 1 / years) - 1) * 100;
  const benchmarkCagr = (Math.pow(last.benchmark / cap, 1 / years) - 1) * 100;

  // daily returns on fixed capital
  const dr: number[] = [];
  for (let i = 1; i < daily.length; i++) dr.push((daily[i].equity - daily[i - 1].equity) / cap);
  const rf = 0.065 / 252;
  const ex = dr.map((r) => r - rf);
  const sharpe = std(dr) ? (mean(ex) / std(dr)) * Math.sqrt(252) : 0;
  const downside = Math.sqrt(mean(ex.map((r) => Math.min(r, 0) ** 2)));
  const sortino = downside ? (mean(ex) / downside) * Math.sqrt(252) : 0;
  let worstDayPct = 0, worstDayDate = "";
  dr.forEach((r, i) => { if (r * 100 < worstDayPct) { worstDayPct = r * 100; worstDayDate = daily[i + 1].d; } });

  // drawdowns (measured in % of starting capital, since capital isn't compounded)
  const dds: Metrics["drawdowns"] = [];
  let peak = daily[0].equity, peakD = daily[0].d, trough = peak, troughD = peakD, inDD = false;
  let longestUW = 0;
  for (const p of daily) {
    if (p.equity >= peak) {
      if (inDD) {
        dds.push({ start: peakD, trough: troughD, end: p.d, depthPct: pct(trough - peak, cap), days: Math.round((Date.parse(p.d) - Date.parse(peakD)) / 86400000) });
        inDD = false;
      }
      peak = p.equity; peakD = p.d; trough = peak; troughD = p.d;
    } else {
      inDD = true;
      if (p.equity < trough) { trough = p.equity; troughD = p.d; }
    }
  }
  if (inDD) dds.push({ start: peakD, trough: troughD, end: null, depthPct: pct(trough - peak, cap), days: Math.round((Date.parse(last.d) - Date.parse(peakD)) / 86400000) });
  dds.forEach((d) => (longestUW = Math.max(longestUW, d.days)));
  dds.sort((a, b) => a.depthPct - b.depthPct);
  const maxDD = dds[0] ?? { start: first.d, trough: first.d, end: first.d, depthPct: 0, days: 0 };

  const wins = traded.filter((c) => c.netPnl > 0);
  const losses = traded.filter((c) => c.netPnl <= 0);
  const avgWin = mean(wins.map((c) => c.returnPct));
  const avgLoss = mean(losses.map((c) => c.returnPct));
  const grossWin = wins.reduce((a, c) => a + c.netPnl, 0);
  const grossLoss = -losses.reduce((a, c) => a + c.netPnl, 0);

  let ls = 0, ws = 0, curL = 0, curW = 0;
  for (const c of traded) {
    if (c.netPnl > 0) { curW++; curL = 0; } else { curL++; curW = 0; }
    ls = Math.max(ls, curL); ws = Math.max(ws, curW);
  }
  const sorted = [...rets].sort((a, b) => a - b);
  const k5 = Math.max(1, Math.floor(sorted.length * 0.05));
  const cvar5 = mean(sorted.slice(0, k5));
  const m = mean(rets), sd = std(rets);
  const skew = sd ? mean(rets.map((r) => ((r - m) / sd) ** 3)) : 0;

  let worstWeek: CycleResult | null = null;
  for (const c of traded) if (!worstWeek || c.returnPct < worstWeek.returnPct) worstWeek = c;
  let weeksToRecover: number | null = null;
  if (worstWeek) {
    const idx = cycles.indexOf(worstWeek);
    let cum = worstWeek.netPnl;
    for (let j = idx + 1; j < cycles.length; j++) {
      cum += cycles[j].netPnl;
      if (cum >= 0) { weeksToRecover = j - idx; break; }
    }
  }

  const adjusted = traded.filter((c) => c.adjustments.length > 0);
  const premium = traded.reduce((a, c) => a + c.premiumCollected, 0);
  const totalCosts = traded.reduce((a, c) => a + c.costs, 0);
  const gross = traded.reduce((a, c) => a + c.grossPnl, 0);
  const avgMargin = mean(traded.map((c) => c.marginUsed));
  const tax = res.spec.costs.taxRatePct;

  // regimes
  const vixB = (v: number) => (v < 12 ? "VIX below 12 (very calm)" : v < 15 ? "VIX 12–15 (calm)" : v < 20 ? "VIX 15–20 (nervous)" : "VIX 20+ (fearful)");
  const moveB = (c: CycleResult) => {
    const r = c.niftyRangePct;
    return r < 1.5 ? "Nifty moved < 1.5%" : r < 3 ? "Nifty moved 1.5–3%" : r < 5 ? "Nifty moved 3–5%" : "Nifty moved 5%+";
  };
  const closes = ds.days.map((d) => d.n[3]);
  const dma = new Map<string, number>();
  for (let i = 49; i < ds.days.length; i++) {
    let s = 0;
    for (let j = i - 49; j <= i; j++) s += closes[j];
    dma.set(ds.days[i].d, s / 50);
  }
  const trendB = (c: CycleResult) => {
    const v = dma.get(c.plannedEntry);
    if (!v) return "Not enough history";
    const r = (c.spotEntry / v - 1) * 100;
    return r > 3 ? "Strong uptrend (>3% above 50-DMA)" : r > 0 ? "Mild uptrend" : r > -3 ? "Mild downtrend" : "Strong downtrend (>3% below 50-DMA)";
  };
  const group = (keyf: (c: CycleResult) => string, order?: string[]) => {
    const g = new Map<string, CycleResult[]>();
    for (const c of cycles) {
      const k = keyf(c);
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(c);
    }
    const keys = order ? order.filter((k) => g.has(k)) : [...g.keys()].sort();
    return keys.map((k) => regime(k, g.get(k)!));
  };

  // gap days
  const dayIdx = new Map(ds.days.map((d, i) => [d.d, i]));
  const gaps: Metrics["gapDays"] = [];
  for (const p of daily) {
    const i = dayIdx.get(p.d)!;
    if (i <= 0) continue;
    const g = (ds.days[i].n[0] / ds.days[i - 1].n[3] - 1) * 100;
    if (Math.abs(g) >= 0.8) {
      const c = cycles.find((c) => c.entryDate && c.entryDate <= p.d && c.exitDate >= p.d) ?? null;
      gaps.push({ d: p.d, gapPct: g, cycleExpiry: c?.expiry ?? null, cyclePct: c?.returnPct ?? null, adjusted: !!c?.adjustments.some((a) => a.date === p.d) });
    }
  }
  gaps.sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));

  // monthly (by exit date)
  const mm = new Map<string, number>();
  for (const c of cycles) {
    const k = c.exitDate.slice(0, 7);
    mm.set(k, (mm.get(k) ?? 0) + c.returnPct);
  }
  const monthly = [...mm.entries()].map(([k, v]) => ({ y: +k.slice(0, 4), m: +k.slice(5, 7), pct: v }));

  // histogram of weekly returns: 0.2% bins between −3% and the best week, with one bucket for the tail
  const TAIL = -3, BW = 0.2;
  const top = Math.ceil(Math.max(0.2, ...rets) / BW) * BW;
  const histogram: Metrics["histogram"] = [];
  const tailCount = rets.filter((r) => r < TAIL).length;
  if (tailCount) histogram.push({ from: Math.min(...rets), to: TAIL, count: tailCount });
  for (let a = TAIL; a < top - 1e-9; a += BW) {
    const b = a + BW;
    histogram.push({ from: a, to: b, count: rets.filter((r) => r >= a && r < b + (b >= top - 1e-9 ? 1e-9 : 0)).length });
  }

  // Monte Carlo: resample one year (52 weeks) of weekly results, 5,000 times
  const rand = rng(42);
  const sims: number[] = [];
  let lossY = 0, dd5 = 0, dd10 = 0, dd20 = 0, hit = 0;
  const target = res.spec.weeklyTargetPct * 52;
  if (allRets.length) {
    for (let s = 0; s < 5000; s++) {
      let cum = 0, pk = 0, mdd = 0;
      for (let w = 0; w < 52; w++) {
        cum += allRets[Math.floor(rand() * allRets.length)];
        pk = Math.max(pk, cum);
        mdd = Math.min(mdd, cum - pk);
      }
      sims.push(cum);
      if (cum < 0) lossY++;
      if (mdd <= -5) dd5++;
      if (mdd <= -10) dd10++;
      if (mdd <= -20) dd20++;
      if (cum >= target) hit++;
    }
  }
  sims.sort((a, b) => a - b);
  const q = (p: number) => sims[Math.min(sims.length - 1, Math.floor(p * sims.length))] ?? 0;

  return {
    capital: cap,
    totalPnl,
    totalReturnPct: pct(totalPnl, cap),
    cagr,
    benchmarkCagr,
    benchmarkReturnPct: pct(last.benchmark - cap, cap),
    fdCagr: 7,
    years,
    avgWeeklyPct: mean(allRets),
    medianWeeklyPct: median(rets),
    targetHitPct: pct(traded.filter((c) => c.returnPct >= res.spec.weeklyTargetPct).length, traded.length),
    targetHitAllPct: pct(cycles.filter((c) => c.returnPct >= res.spec.weeklyTargetPct).length, cycles.length),
    maxDDPct: maxDD.depthPct,
    maxDDRupees: (maxDD.depthPct / 100) * cap,
    maxDDStart: maxDD.start,
    maxDDTrough: maxDD.trough,
    maxDDRecovery: maxDD.end,
    longestUnderwaterDays: longestUW,
    sharpe,
    sortino,
    calmar: maxDD.depthPct ? cagr / Math.abs(maxDD.depthPct) : 0,
    volAnnualPct: std(dr) * Math.sqrt(252) * 100,
    cycles: cycles.length,
    traded: traded.length,
    skipped: cycles.length - traded.length,
    winRate: pct(wins.length, traded.length),
    avgWinPct: avgWin,
    avgLossPct: avgLoss,
    payoff: avgLoss ? Math.abs(avgWin / avgLoss) : 0,
    breakevenWinRate: avgWin - avgLoss ? (Math.abs(avgLoss) / (avgWin + Math.abs(avgLoss))) * 100 : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? 99 : 0,
    expectancyRupees: mean(traded.map((c) => c.netPnl)),
    bestWeekPct: rets.length ? Math.max(...rets) : 0,
    worstWeekPct: rets.length ? Math.min(...rets) : 0,
    worstWeek,
    worstDayPct,
    worstDayDate,
    cvar5Pct: cvar5,
    skew,
    longestLosingStreak: ls,
    longestWinningStreak: ws,
    weeksToRecoverWorst: weeksToRecover,
    adjustedCycles: adjusted.length,
    adjustedWinRate: pct(adjusted.filter((c) => c.netPnl > 0).length, adjusted.length),
    adjustedAvgPct: mean(adjusted.map((c) => c.returnPct)),
    totalAdjustments: traded.reduce((a, c) => a + c.adjustments.length, 0),
    uncoveredAdjustments: traded.reduce((a, c) => a + c.adjustments.filter((x) => x.covered === false).length, 0),
    touchedCycles: traded.filter((c) => c.touchedStrike).length,
    premiumCollected: premium,
    captureRatio: pct(traded.reduce((a, c) => a + c.netPnl, 0), premium),
    totalCosts,
    costDragPct: gross > 0 ? pct(totalCosts, gross) : 0,
    avgLots: mean(traded.map((c) => c.lots)),
    avgMargin,
    romAnnualPct: avgMargin ? (mean(allRets.map((r) => (r / 100) * cap)) * 52 / avgMargin) * 100 : 0,
    taxPct: tax,
    postTaxPnl: totalPnl > 0 ? totalPnl * (1 - tax / 100) : totalPnl,
    timeInMarketPct: pct(daily.filter((d) => d.inPos).length, daily.length),
    regimes: {
      vix: group((c) => vixB(c.vixEntry), ["VIX below 12 (very calm)", "VIX 12–15 (calm)", "VIX 15–20 (nervous)", "VIX 20+ (fearful)"]),
      move: group(moveB, ["Nifty moved < 1.5%", "Nifty moved 1.5–3%", "Nifty moved 3–5%", "Nifty moved 5%+"]),
      trend: group(trendB, ["Strong uptrend (>3% above 50-DMA)", "Mild uptrend", "Mild downtrend", "Strong downtrend (>3% below 50-DMA)", "Not enough history"]),
      expiryDay: group((c) => `${c.expiryWeekday} expiry`),
      year: group((c) => c.exitDate.slice(0, 4)),
      gap: group((c) => {
        const g = gaps.find((x) => x.cycleExpiry === c.expiry && Math.abs(x.gapPct) >= 1);
        return g ? "Week with a 1%+ gap" : "No big gap";
      }, ["No big gap", "Week with a 1%+ gap"]),
    },
    monthly,
    histogram,
    drawdowns: dds.slice(0, 5),
    monteCarlo: {
      p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95),
      probLossYear: pct(lossY, sims.length), probDD5: pct(dd5, sims.length), probDD10: pct(dd10, sims.length),
      probDD20: pct(dd20, sims.length), probHitTarget: pct(hit, sims.length),
    },
    gapDays: gaps.slice(0, 15),
  };
}
