import { runBacktest } from "./engine";
import { computeMetrics } from "./metrics";
import type { Dataset, StrategySpec } from "./types";

export interface ScanParam {
  key: string;
  label: string;
  path: [string, string] | [string];
  values: number[];
  fmt: (v: number) => string;
}

export const SCAN_PARAMS: ScanParam[] = [
  { key: "targetPremiumPct", label: "Premium target per week (% of capital)", path: ["strikes", "targetPremiumPct"], values: [0.3, 0.4, 0.5, 0.6, 0.8], fmt: (v) => `${v}%` },
  { key: "minOtmPercent", label: "Comfort floor (% away from Nifty)", path: ["strikes", "minOtmPercent"], values: [1, 1.5, 2, 2.5, 3], fmt: (v) => `${v}%` },
  { key: "gapAdjustPct", label: "Gap that triggers an adjustment", path: ["risk", "gapAdjustPct"], values: [0, 0.75, 1, 1.5, 2], fmt: (v) => (v === 0 ? "Off" : `${v}%`) },
  { key: "breachBufferPct", label: "Adjust when Nifty is within … of a strike", path: ["risk", "breachBufferPct"], values: [-1, 0, 0.25, 0.5, 1], fmt: (v) => (v < 0 ? "Off" : `${v}%`) },
  { key: "stopLossPctOfCapital", label: "Weekly stop-loss (% of capital)", path: ["risk", "stopLossPctOfCapital"], values: [0, 1, 1.5, 2, 3], fmt: (v) => (v === 0 ? "None" : `${v}%`) },
  { key: "maxAdjustmentsPerCycle", label: "Max adjustments per week", path: ["risk", "maxAdjustmentsPerCycle"], values: [0, 1, 2, 3], fmt: (v) => `${v}` },
  { key: "takeProfitPctOfPremium", label: "Book profit at … of premium decayed", path: ["risk", "takeProfitPctOfPremium"], values: [0, 50, 70, 80, 90], fmt: (v) => (v === 0 ? "Never" : `${v}%`) },
  { key: "daysAfterExpiry", label: "Entry day (sessions after expiry)", path: ["entry", "daysAfterExpiry"], values: [0, 1, 2], fmt: (v) => (v === 0 ? "Expiry day" : `+${v}`) },
  { key: "daysBeforeExpiry", label: "Exit day (sessions before expiry)", path: ["exit", "daysBeforeExpiry"], values: [0, 1, 2], fmt: (v) => (v === 0 ? "Hold to expiry" : `−${v}`) },
];

export function getParam(spec: StrategySpec, p: ScanParam): number {
  const o: any = spec;
  return p.path.length === 2 ? o[p.path[0]][p.path[1]] : o[p.path[0]];
}

export function setParam(spec: StrategySpec, p: ScanParam, v: number): StrategySpec {
  const s: any = structuredClone(spec);
  if (p.path.length === 2) s[p.path[0]][p.path[1]] = v; else s[p.path[0]] = v;
  return s;
}

export interface ScanCell {
  a: number; b: number;
  cagr: number; maxDD: number; calmar: number; targetHit: number; winRate: number; worstWeek: number; totalPnl: number;
}

export async function runScan(
  ds: Dataset, spec: StrategySpec, pa: ScanParam, pb: ScanParam, range: { from?: string; to?: string },
  onProgress?: (done: number, total: number) => void,
): Promise<ScanCell[]> {
  const cells: ScanCell[] = [];
  const total = pa.values.length * pb.values.length;
  for (const a of pa.values) {
    for (const b of pb.values) {
      const s = setParam(setParam(spec, pa, a), pb, b);
      const r = runBacktest(ds, s, range);
      const m = computeMetrics(r, ds);
      cells.push({ a, b, cagr: m.cagr, maxDD: m.maxDDPct, calmar: m.calmar, targetHit: m.targetHitAllPct, winRate: m.winRate, worstWeek: m.worstWeekPct, totalPnl: m.totalPnl });
      onProgress?.(cells.length, total);
      await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
    }
  }
  return cells;
}
