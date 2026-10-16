import fs from "fs";
import path from "path";
import { runBacktest } from "../lib/engine";
import { computeMetrics } from "../lib/metrics";
import { DAD_SPEC, mergeSpec } from "../lib/defaults";
import type { Dataset, DayData } from "../lib/types";

const dir = path.join(__dirname, "..", "public", "data");
const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
const days: DayData[] = meta.years.flatMap((y: string) => JSON.parse(fs.readFileSync(path.join(dir, `days-${y}.json`), "utf8")));
const ds: Dataset = { meta, days };

const variants: [string, any][] = [
  ["dad (intraday fills)", {}],
  ["dad (close fills)", { intradayFill: "close" }],
  ["no adjustments", { risk: { gapAdjustPct: 0, breachBufferPct: -1 } }],
];
const from = process.argv[2] ?? "2021-10-01";
for (const [name, patch] of variants) {
  const spec = mergeSpec(DAD_SPEC, patch);
  const t0 = Date.now();
  const r = runBacktest(ds, spec, { from });
  const m = computeMetrics(r, ds);
  console.log(`\n== ${name}  (${Date.now() - t0}ms)  ${r.start} → ${r.end}`);
  console.log({
    cycles: m.cycles, traded: m.traded, skipped: m.skipped, totalPnl: Math.round(m.totalPnl), cagr: m.cagr.toFixed(2),
    maxDD: m.maxDDPct.toFixed(2), win: m.winRate.toFixed(1), avgWk: m.avgWeeklyPct.toFixed(3), targetHit: m.targetHitPct.toFixed(1),
    worstWk: m.worstWeekPct.toFixed(2), adj: m.totalAdjustments, costs: Math.round(m.totalCosts), sharpe: m.sharpe.toFixed(2), lots: m.avgLots.toFixed(1),
  });
  if (name.startsWith("dad (intraday")) {
    for (const c of r.cycles.slice(0, 6)) {
      console.log(c.expiry, c.expiryWeekday, "entry", c.entryDate, "exit", c.exitDate, "lots", c.lots, "K", c.initialPE, c.initialCE, "spot", c.spotEntry.toFixed(0),
        "prem", Math.round(c.premiumCollected), "net", Math.round(c.netPnl), c.returnPct.toFixed(2) + "%", c.adjustments.map((a) => a.reason).join("; "), c.skipped ?? "");
    }
    const w = m.worstWeek!;
    console.log("WORST", w.expiry, w.returnPct.toFixed(2), w.adjustments, w.legs.map((l) => `${l.side} ${l.type}${l.strike} ${l.entryDate}@${l.entryPrice.toFixed(1)} → ${l.exitDate}@${l.exitPrice?.toFixed(1)}`));
  }
}
