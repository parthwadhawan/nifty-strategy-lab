// ---------- Market data ----------

/** [open, high, low, close] — 0 means "no trade that day" */
export type OHLC = [number, number, number, number];

export interface ExpiryChain {
  e: string; // expiry date ISO
  k0: number; // first strike
  st: number; // strike step (50)
  ce: (OHLC | null)[];
  pe: (OHLC | null)[];
}

export interface DayData {
  d: string; // ISO date
  n: OHLC; // Nifty 50
  v: OHLC | null; // India VIX
  x: ExpiryChain[]; // nearest expiries (>= today), sorted
}

export interface Dataset {
  meta: { start: string; end: string; generated: string; source: string };
  days: DayData[];
}

// ---------- Strategy ----------

export type Structure = "strangle" | "straddle" | "iron_condor";
export type StrikeMethod = "target_premium" | "otm_percent" | "sd_move";
export type AdjustAction = "roll_cover_loss" | "roll_same" | "exit";

export interface StrategySpec {
  name: string;
  description: string;
  structure: Structure;
  entry: {
    /** 1 = first trading day after the previous expiry (e.g. Wednesday when expiry is Tuesday). 0 = on the previous expiry day itself */
    daysAfterExpiry: number;
    /** if the target premium isn't available at comfortable strikes, try again the next day */
    retryIfPremiumShort: boolean;
    /** stop trying to enter when fewer than this many sessions remain before the exit day */
    lastEntryDaysBeforeExit: number;
    /** 'open' ≈ 9:16 am entry, 'close' ≈ 3:25 pm entry */
    entryPrice: "open" | "close";
  };
  exit: {
    /** 1 = exit at close of the last trading day before expiry (Monday when expiry is Tuesday). 0 = hold to expiry */
    daysBeforeExpiry: number;
  };
  strikes: {
    method: StrikeMethod;
    /** total premium (both legs) to collect per cycle, as % of capital. Pro-rated if entry is delayed */
    targetPremiumPct: number;
    otmPercent: number;
    sdMultiple: number;
    /** comfort floor — never sell a strike closer than this % from Nifty */
    minOtmPercent: number;
  };
  wings: { enabled: boolean; distancePercent: number };
  sizing: {
    capital: number;
    mode: "auto_capital" | "fixed_lots";
    lots: number;
    /** estimated margin needed per lot as % of notional (Nifty × lot size) */
    marginPctOfNotional: number;
  };
  risk: {
    /** adjust when Nifty opens this % away from previous close. 0 = off */
    gapAdjustPct: number;
    /** adjust when Nifty closes within this % of a short strike. Negative = off */
    breachBufferPct: number;
    adjustAction: AdjustAction;
    maxAdjustmentsPerCycle: number;
    /** what to do when another trigger fires after the max adjustments are used */
    afterMaxAdjust: "exit" | "hold";
    /** comfort floor used when re-entering after an adjustment */
    adjustMinOtmPercent: number;
    /** exit the cycle if loss exceeds this % of capital. 0 = off */
    stopLossPctOfCapital: number;
    /** book profit when this % of collected premium has been captured. 0 = off */
    takeProfitPctOfPremium: number;
  };
  costs: { brokeragePerOrder: number; slippagePct: number; taxRatePct: number };
  /** the trader's weekly goal, used for reporting */
  weeklyTargetPct: number;
  /** how strike-breach adjustments are detected with daily data:
   * 'intraday' = when Nifty's day high/low touches the trigger, priced with each option's own implied vol (estimate)
   * 'close'    = only checked at the 3:30 close using actual closing prices */
  intradayFill: "close" | "intraday";
}

// ---------- Results ----------

export interface Leg {
  type: "CE" | "PE";
  side: "sell" | "buy";
  strike: number;
  qty: number;
  entryDate: string;
  entryPrice: number;
  exitDate?: string;
  exitPrice?: number;
  estimated?: boolean;
}

export interface Adjustment {
  date: string;
  reason: string;
  realizedSoFar: number;
  newCE?: number;
  newPE?: number;
  covered?: boolean;
}

export interface CycleResult {
  expiry: string;
  expiryWeekday: string;
  plannedEntry: string;
  entryDate: string | null;
  exitDate: string;
  skipped: string | null;
  lots: number;
  lotSize: number;
  legs: Leg[];
  initialCE: number | null;
  initialPE: number | null;
  premiumCollected: number; // ₹, all sold premium incl. re-entries
  grossPnl: number;
  costs: number;
  netPnl: number;
  returnPct: number; // net / capital
  adjustments: Adjustment[];
  spotEntry: number;
  spotExit: number;
  niftyMovePct: number;
  niftyRangePct: number; // max intraday excursion from entry spot (abs, %)
  vixEntry: number;
  worstMtm: number; // most negative mark-to-market during cycle (₹)
  touchedStrike: boolean;
  closestApproachPct: number; // closest Nifty came to a short strike (% of spot, can be negative if breached)
  events: string[];
  exitReason: string;
  estimatedPrices: number;
  marginUsed: number;
}

export interface DailyPoint {
  d: string;
  equity: number;
  nifty: number;
  benchmark: number; // Nifty buy & hold equity
  inPos: boolean;
}

export interface BacktestResult {
  spec: StrategySpec;
  cycles: CycleResult[];
  daily: DailyPoint[];
  start: string;
  end: string;
  warnings: string[];
  openCycle?: {
    expiry: string;
    state: "waiting" | "open" | "done";
    asOf: string;
    openLegs: Leg[];
    cycle: CycleResult | null;
    sessionsLeft: number;
    qty: number;
    lots: number;
    lotSize: number;
    netSoFar: number;
    adjustments: Adjustment[];
  };
}
