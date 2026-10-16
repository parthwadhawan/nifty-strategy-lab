import type { StrategySpec } from "./types";

export const DEFAULT_SPEC: StrategySpec = {
  name: "Weekly short strangle",
  description: "",
  structure: "strangle",
  entry: { daysAfterExpiry: 1, retryIfPremiumShort: true, lastEntryDaysBeforeExit: 1, entryPrice: "open" },
  exit: { daysBeforeExpiry: 1 },
  strikes: { method: "target_premium", targetPremiumPct: 0.5, otmPercent: 2, sdMultiple: 1, minOtmPercent: 1.5 },
  wings: { enabled: false, distancePercent: 2 },
  sizing: { capital: 1000000, mode: "auto_capital", lots: 1, marginPctOfNotional: 9 },
  risk: {
    gapAdjustPct: 1,
    breachBufferPct: 0.5,
    adjustAction: "roll_cover_loss",
    maxAdjustmentsPerCycle: 2,
    afterMaxAdjust: "exit",
    adjustMinOtmPercent: 1,
    stopLossPctOfCapital: 0,
    takeProfitPctOfPremium: 0,
  },
  costs: { brokeragePerOrder: 20, slippagePct: 1, taxRatePct: 30 },
  weeklyTargetPct: 0.5,
  intradayFill: "intraday",
};

export const DAD_TRANSCRIPT = `I need to make 0.5% per week on a weekly Nifty option strategy. Nifty expires every Tuesday, so this strategy should start running from 9:16 in the morning on Wednesday and should generally end by Monday at 3:30.

The way this will work is that I will be creating sell options on both the put and call sides. The total premium that I would want to collect is such that I should be making approximately 0.1% every day. If it is not being made, then probably I'll move on to the next day.

Again, the premiums have to be at a strike price that should keep me comfortable, so that they don't come very close to adding money and creating a danger of big losses. If this happens and there is a big gap up or gap down, it should automatically close the positions, create new positions that are able to compensate for the loss, and create a new strangle.`;

export const DAD_SPEC: StrategySpec = {
  ...DEFAULT_SPEC,
  name: "Papa's weekly 0.5% strangle",
  description: DAD_TRANSCRIPT,
};

/** Deep-merge a partial spec (from the AI or a suggestion) onto a full one */
export function mergeSpec(base: StrategySpec, patch: unknown): StrategySpec {
  const out: any = structuredClone(base);
  const walk = (o: any, p: any) => {
    if (!p || typeof p !== "object") return;
    for (const k of Object.keys(p)) {
      if (!(k in o)) continue;
      const v = p[k];
      if (v && typeof v === "object" && !Array.isArray(v) && typeof o[k] === "object") walk(o[k], v);
      else if (v !== null && v !== undefined && typeof v === typeof o[k]) o[k] = v;
    }
  };
  walk(out, patch);
  return out as StrategySpec;
}
