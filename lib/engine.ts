import type {
  Adjustment, BacktestResult, CycleResult, Dataset, DayData, DailyPoint, ExpiryChain, Leg, OHLC, StrategySpec,
} from "./types";
import { bsPrice, calendarDays, expectedMove, legCharges, MARKET_EVENTS, niftyLotSize } from "./market";

type Field = "o" | "c";
const FI = { o: 0, h: 1, l: 2, c: 3 } as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Px { p: number; est: boolean }
type Pricer = (type: "CE" | "PE", K: number) => Px;

// ---------- Data helpers ----------

export function chainFor(day: DayData, expiry: string): ExpiryChain | undefined {
  return day.x.find((c) => c.e === expiry);
}

function quote(ch: ExpiryChain | undefined, type: "CE" | "PE", K: number): OHLC | null {
  if (!ch) return null;
  const i = Math.round((K - ch.k0) / ch.st);
  const arr = type === "CE" ? ch.ce : ch.pe;
  if (i < 0 || i >= arr.length) return null;
  return arr[i];
}

export function strikesOf(ch: ExpiryChain | undefined): number[] {
  if (!ch) return [];
  return ch.ce.map((_, i) => ch.k0 + i * ch.st);
}

/** years to expiry at the given moment of the day (open ≈ 9:15, close ≈ 15:30, expiry at 15:30) */
function yearsTo(date: string, expiry: string, field: Field | "mid") {
  const extra = field === "o" ? 0.26 : field === "mid" ? 0.13 : 0; // fraction of a calendar day of trading left
  return (calendarDays(date, expiry) + extra) / 365;
}

function vixOf(day: DayData, field: Field | "h") {
  if (!day.v) return 15;
  const v = day.v[FI[field]] || day.v[3];
  return v > 0 ? v : 15;
}

/** Pricer using actual bhavcopy prices (open or close), falling back to Black–Scholes on VIX when a strike didn't trade */
export function marketPricer(day: DayData, expiry: string, field: Field): Pricer {
  const ch = chainFor(day, expiry);
  const S = day.n[FI[field]] || day.n[3];
  return (type, K) => {
    const q = quote(ch, type, K);
    const v = q ? q[FI[field]] : 0;
    if (v > 0) return { p: v, est: false };
    const p = bsPrice(type, S, K, yearsTo(day.d, expiry, field), vixOf(day, field) / 100);
    return { p: Math.max(p, 0.05), est: true };
  };
}

function impliedVol(type: "CE" | "PE", S: number, K: number, T: number, price: number) {
  let lo = 0.01, hi = 3;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (bsPrice(type, S, K, T, mid) > price) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Pricer for an intraday moment when Nifty is at spot S: sticky-strike re-pricing using each option's implied vol from the day's close */
function intradayPricer(day: DayData, expiry: string, S: number): Pricer {
  const ch = chainFor(day, expiry);
  const Tc = Math.max(yearsTo(day.d, expiry, "c"), 0.5 / 365);
  const Tm = yearsTo(day.d, expiry, "mid");
  const Sc = day.n[3];
  return (type, K) => {
    const q = quote(ch, type, K);
    let iv = vixOf(day, "h") / 100;
    if (q && q[3] > 0.5) iv = impliedVol(type, Sc, K, Tc, q[3]);
    const p = bsPrice(type, S, K, Tm, iv);
    return { p: Math.max(p, 0.05), est: true };
  };
}

function roundUp(x: number, step: number) { return Math.ceil(x / step) * step; }
function roundDown(x: number, step: number) { return Math.floor(x / step) * step; }
function roundNear(x: number, step: number) { return Math.round(x / step) * step; }

// ---------- Strike selection ----------

interface Selection { ok: boolean; covered: boolean; ce: number; pe: number; reason?: string }

export function selectStrikes(
  spec: StrategySpec, day: DayData, expiry: string, spot: number, vix: number, pricer: Pricer,
  needPts: number, floorPct: number, allowFloorFallback: boolean,
): Selection {
  const ch = chainFor(day, expiry);
  const ks = strikesOf(ch);
  if (!ks.length) return { ok: false, covered: false, ce: 0, pe: 0, reason: "no option data" };
  const step = ch!.st;
  const ceFloor = roundUp(spot * (1 + floorPct / 100), step);
  const peFloor = roundDown(spot * (1 - floorPct / 100), step);
  const m = spec.strikes.method;

  if (spec.structure === "straddle") {
    const k = roundNear(spot, step);
    return { ok: true, covered: true, ce: k, pe: k };
  }
  if (m === "otm_percent" || m === "sd_move") {
    let dist = m === "otm_percent" ? spot * spec.strikes.otmPercent / 100
      : spec.strikes.sdMultiple * expectedMove(spot, vix, day.d, expiry);
    const ce = Math.max(roundUp(spot + dist, step), ceFloor);
    const pe = Math.min(roundDown(spot - dist, step), peFloor);
    return { ok: true, covered: true, ce, pe };
  }

  // target_premium: farthest strikes whose premium still meets the target, never closer than the comfort floor
  const ceK = ks.filter((k) => k >= ceFloor).sort((a, b) => a - b);
  const peK = ks.filter((k) => k <= peFloor).sort((a, b) => b - a);
  if (!ceK.length || !peK.length) return { ok: false, covered: false, ce: 0, pe: 0, reason: "no strikes beyond comfort floor" };

  const farthest = (list: number[], type: "CE" | "PE", need: number): number | null => {
    let best: number | null = null;
    for (const k of list) {
      const { p } = pricer(type, k);
      if (p >= need) best = k; else break; // premiums fall as we go further OTM
    }
    return best;
  };
  const ceMax = pricer("CE", ceK[0]).p;
  const peMax = pricer("PE", peK[0]).p;
  if (ceMax + peMax < needPts) {
    if (allowFloorFallback) return { ok: true, covered: false, ce: ceK[0], pe: peK[0] };
    return { ok: false, covered: false, ce: 0, pe: 0, reason: "premium short at comfortable strikes" };
  }
  const half = needPts / 2;
  let ce = farthest(ceK, "CE", half);
  let pe = farthest(peK, "PE", half);
  if (ce === null && pe !== null) { ce = ceK[0]; pe = farthest(peK, "PE", needPts - ceMax) ?? peK[0]; }
  else if (pe === null && ce !== null) { pe = peK[0]; ce = farthest(ceK, "CE", needPts - peMax) ?? ceK[0]; }
  else if (ce === null && pe === null) { ce = ceK[0]; pe = peK[0]; }
  return { ok: true, covered: true, ce: ce!, pe: pe! };
}

// ---------- Backtest ----------

export function runBacktest(ds: Dataset, spec: StrategySpec, range?: { from?: string; to?: string; openCycle?: boolean }): BacktestResult {
  const all = ds.days;
  const from = range?.from ?? all[0].d;
  const to = range?.to ?? all[all.length - 1].d;
  const days = all.filter((d) => d.d >= from && d.d <= to);
  const warnings: string[] = [];
  const cap = spec.sizing.capital;
  const slip = spec.costs.slippagePct / 100;
  const brk = spec.costs.brokeragePerOrder;

  // nearest expiry per day → ordered list of distinct expiries present in the data
  const expiries: string[] = [];
  for (const d of days) {
    const e = d.x[0]?.e;
    if (e && expiries[expiries.length - 1] !== e) expiries.push(e);
  }
  const dayIdx = new Map(days.map((d, i) => [d.d, i]));
  const inc = new Array(days.length).fill(0);
  const inPos = new Array(days.length).fill(false);
  const cycles: CycleResult[] = [];
  let openCycle: BacktestResult["openCycle"];

  for (let ei = 1; ei < expiries.length; ei++) {
    const ePrev = expiries[ei - 1], E = expiries[ei];
    const i0 = dayIdx.get(ePrev), iE = dayIdx.get(E);
    if (i0 === undefined) continue;
    const isOpen = iE === undefined;
    if (isOpen && !(range?.openCycle && ei === expiries.length - 1)) continue; // incomplete cycle at the edge
    const sessions: number[] = [];
    for (let i = i0; i <= (iE ?? days.length - 1); i++) sessions.push(i);
    let totalLen = sessions.length;
    if (isOpen) {
      // the cycle is still running: count remaining weekdays up to expiry (holidays unknown)
      totalLen = 0;
      for (let t = Date.parse(ePrev); t <= Date.parse(E); t += 86400000) {
        const wd = new Date(t).getUTCDay();
        if (wd !== 0 && wd !== 6) totalLen++;
      }
    }
    const entryT = spec.entry.daysAfterExpiry;
    const exitT = totalLen - 1 - spec.exit.daysBeforeExpiry;
    if (entryT > exitT || entryT < 0) continue;
    if (entryT > sessions.length - 1) {
      openCycle = { expiry: E, state: "waiting", asOf: days[days.length - 1].d, openLegs: [], cycle: null, sessionsLeft: exitT - (sessions.length - 1), qty: 0, lots: 0, lotSize: niftyLotSize(E), netSoFar: 0, adjustments: [] };
      continue;
    }
    const fullSessions = exitT - entryT + 1;

    const lotSize = niftyLotSize(E);
    const planned = days[sessions[entryT]];
    const notional = planned.n[0] * lotSize;
    let lots = spec.sizing.mode === "fixed_lots" ? Math.max(1, Math.round(spec.sizing.lots))
      : Math.max(1, Math.floor(cap / (notional * spec.sizing.marginPctOfNotional / 100)));
    const qty = lots * lotSize;

    let open: Leg[] = [];
    const closedLegs: Leg[] = [];
    let realized = 0, costs = 0, premium = 0, estimated = 0;
    const adjustments: Adjustment[] = [];
    let state: "waiting" | "open" | "done" = "waiting";
    let entryDate: string | null = null, skipped: string | null = null, exitReason = "";
    let initialCE: number | null = null, initialPE: number | null = null;
    let spotEntry = 0, vixEntry = 0, worstMtm = 0, closest = Infinity, touched = false, rangePct = 0;

    const fill = (side: "sell" | "buy", p: number) => {
      const s = Math.max(p * slip, 0.05);
      return side === "sell" ? Math.max(p - s, 0.05) : p + s;
    };
    const openLegs = (sel: Selection, pricer: Pricer, date: string) => {
      const mk = (type: "CE" | "PE", side: "sell" | "buy", K: number) => {
        const px = pricer(type, K);
        if (px.est) estimated++;
        const price = fill(side, px.p);
        costs += legCharges(date, side, price * qty, brk);
        if (side === "sell") premium += price * qty; else premium -= price * qty;
        open.push({ type, side, strike: K, qty, entryDate: date, entryPrice: price, estimated: px.est });
      };
      mk("CE", "sell", sel.ce);
      mk("PE", "sell", sel.pe);
      if (spec.structure === "iron_condor" || spec.wings.enabled) {
        const w = spec.wings.distancePercent || 2;
        mk("CE", "buy", roundUp(sel.ce * (1 + w / 100), 50));
        mk("PE", "buy", roundDown(sel.pe * (1 - w / 100), 50));
      }
    };
    const closeAll = (pricer: Pricer, date: string) => {
      for (const l of open) {
        const px = pricer(l.type, l.strike);
        if (px.est) estimated++;
        const exitSide = l.side === "sell" ? "buy" : "sell";
        const price = fill(exitSide, px.p);
        costs += legCharges(date, exitSide, price * qty, brk);
        realized += l.side === "sell" ? (l.entryPrice - price) * l.qty : (price - l.entryPrice) * l.qty;
        closedLegs.push({ ...l, exitDate: date, exitPrice: price, estimated: l.estimated || px.est });
      }
      open = [];
    };
    const settleAll = (spot: number, date: string) => {
      for (const l of open) {
        const intrinsic = l.type === "CE" ? Math.max(spot - l.strike, 0) : Math.max(l.strike - spot, 0);
        // long ITM options exercised at expiry pay STT of 0.125% on intrinsic value
        if (intrinsic > 0 && l.side === "buy") costs += 0.00125 * intrinsic * l.qty;
        realized += l.side === "sell" ? (l.entryPrice - intrinsic) * l.qty : (intrinsic - l.entryPrice) * l.qty;
        closedLegs.push({ ...l, exitDate: date, exitPrice: intrinsic });
      }
      open = [];
    };
    const mtm = (pricer: Pricer) =>
      open.reduce((s, l) => {
        const p = pricer(l.type, l.strike).p;
        return s + (l.side === "sell" ? (l.entryPrice - p) : (p - l.entryPrice)) * l.qty;
      }, 0);
    const shorts = () => ({
      ce: open.find((l) => l.type === "CE" && l.side === "sell")?.strike,
      pe: open.find((l) => l.type === "PE" && l.side === "sell")?.strike,
    });

    const adjust = (t: number, day: DayData, pricer: Pricer, spot: number, vix: number, reason: string, remainingInclToday: number) => {
      if (adjustments.length >= spec.risk.maxAdjustmentsPerCycle) {
        if (spec.risk.afterMaxAdjust === "exit") {
          closeAll(pricer, day.d);
          state = "done"; exitReason = `${reason} — adjustments used up, exited`;
        }
        return;
      }
      closeAll(pricer, day.d);
      const net = realized - costs;
      if (spec.risk.adjustAction === "exit") {
        adjustments.push({ date: day.d, reason, realizedSoFar: net });
        state = "done"; exitReason = `${reason} — exited`;
        return;
      }
      const prorate = Math.max(remainingInclToday, 0) / fullSessions;
      let need = (spec.strikes.targetPremiumPct / 100) * cap * prorate / qty;
      if (spec.risk.adjustAction === "roll_cover_loss") need += Math.max(0, -net) / qty;
      const sel = selectStrikes(spec, day, E, spot, vix, pricer, need, spec.risk.adjustMinOtmPercent, true);
      if (!sel.ok) {
        adjustments.push({ date: day.d, reason, realizedSoFar: net });
        state = "done"; exitReason = `${reason} — no strikes to roll into`;
        return;
      }
      openLegs(sel, pricer, day.d);
      adjustments.push({ date: day.d, reason, realizedSoFar: net, newCE: sel.ce, newPE: sel.pe, covered: sel.covered });
    };

    let lastContribution = 0;
    const lastT = Math.min(exitT, sessions.length - 1);
    for (let t = entryT; t <= lastT; t++) {
      const di = sessions[t];
      const day = days[di];
      const prevDay = days[di - 1];
      let actedToday = false;
      const hadPosAtOpen = open.length > 0;

      // 1a) stop-loss checked at the open too (gaps can blow through it)
      if (state === "open" && spec.risk.stopLossPctOfCapital > 0) {
        const op = marketPricer(day, E, "o");
        if (realized - costs + mtm(op) <= -cap * spec.risk.stopLossPctOfCapital / 100) {
          closeAll(op, day.d); state = "done"; actedToday = true;
          exitReason = `Stop-loss hit at the open (${spec.risk.stopLossPctOfCapital}% of capital)`;
        }
      }
      // 1b) gap at the open
      if (state === "open" && prevDay && spec.risk.gapAdjustPct > 0) {
        const g = (day.n[0] / prevDay.n[3] - 1) * 100;
        if (Math.abs(g) >= spec.risk.gapAdjustPct) {
          adjust(t, day, marketPricer(day, E, "o"), day.n[0], vixOf(day, "o"),
            `Gap ${g > 0 ? "up" : "down"} ${g.toFixed(1)}% at open`, exitT - t + 1);
          actedToday = true;
        }
      }

      // 2) entry
      let enteredToday = false;
      if (state === "waiting") {
        const remainingAfter = exitT - t;
        if (remainingAfter < spec.entry.lastEntryDaysBeforeExit) {
          state = "done"; skipped = skipped ?? "Target premium never available at comfortable strikes";
        } else {
          const f: Field = spec.entry.entryPrice === "close" ? "c" : "o";
          const pricer = marketPricer(day, E, f);
          const spot = day.n[FI[f]] || day.n[3];
          const prorate = (exitT - t + 1) / fullSessions;
          const need = (spec.strikes.targetPremiumPct / 100) * cap * prorate / qty;
          const sel = selectStrikes(spec, day, E, spot, vixOf(day, f), pricer, need, spec.strikes.minOtmPercent, false);
          if (sel.ok) {
            openLegs(sel, pricer, day.d);
            state = "open"; entryDate = day.d; enteredToday = true;
            initialCE = sel.ce; initialPE = sel.pe; spotEntry = spot; vixEntry = vixOf(day, f);
          } else if (!spec.entry.retryIfPremiumShort) {
            state = "done"; skipped = sel.reason ?? "Premium short";
          } else {
            skipped = sel.reason ?? "Premium short";
          }
        }
      }

      // 3) intraday breach (estimated) — not on the entry day or a day we already adjusted
      if (state === "open" && t < exitT && !actedToday && !enteredToday && spec.intradayFill === "intraday" && spec.risk.breachBufferPct >= 0) {
        const s = shorts();
        const buf = spec.risk.breachBufferPct / 100;
        const upTrig = s.ce ? s.ce * (1 - buf) : Infinity;
        const dnTrig = s.pe ? s.pe * (1 + buf) : -Infinity;
        const hitUp = day.n[1] >= upTrig, hitDn = day.n[2] <= dnTrig;
        if (hitUp || hitDn) {
          // if both were hit we can't know the order; assume the one closer to the open hit first
          const up = hitUp && (!hitDn || Math.abs(upTrig - day.n[0]) <= Math.abs(day.n[0] - dnTrig));
          const S = up ? Math.max(upTrig, day.n[0]) : Math.min(dnTrig, day.n[0]);
          adjust(t, day, intradayPricer(day, E, S), S, vixOf(day, "h"),
            `Nifty ${up ? "rallied" : "fell"} to within ${spec.risk.breachBufferPct}% of the ${up ? "call" : "put"} strike`, exitT - t);
          actedToday = true;
        }
      }

      // 4) checks at the close
      if (state === "open" && t < exitT && !actedToday && !(enteredToday && spec.entry.entryPrice === "close")) {
        const cp = marketPricer(day, E, "c");
        const s = shorts();
        const buf = spec.risk.breachBufferPct / 100;
        if (spec.risk.breachBufferPct >= 0 && spec.intradayFill === "close" &&
          ((s.ce && day.n[3] >= s.ce * (1 - buf)) || (s.pe && day.n[3] <= s.pe * (1 + buf)))) {
          const up = !!(s.ce && day.n[3] >= s.ce * (1 - buf));
          adjust(t, day, cp, day.n[3], vixOf(day, "c"),
            `Nifty closed within ${spec.risk.breachBufferPct}% of the ${up ? "call" : "put"} strike`, exitT - t);
        } else {
          const net = realized - costs + mtm(cp);
          if (spec.risk.stopLossPctOfCapital > 0 && net <= -cap * spec.risk.stopLossPctOfCapital / 100) {
            closeAll(cp, day.d); state = "done"; exitReason = `Stop-loss hit (${spec.risk.stopLossPctOfCapital}% of capital)`;
          } else if (spec.risk.takeProfitPctOfPremium > 0) {
            const openPrem = open.reduce((a, l) => a + (l.side === "sell" ? l.entryPrice : -l.entryPrice) * l.qty, 0);
            if (openPrem > 0 && mtm(cp) >= openPrem * spec.risk.takeProfitPctOfPremium / 100) {
              closeAll(cp, day.d); state = "done"; exitReason = `Profit booked (${spec.risk.takeProfitPctOfPremium}% of premium captured)`;
            }
          }
        }
      }

      // 5) scheduled exit
      if (t === exitT && state === "open") {
        if (spec.exit.daysBeforeExpiry === 0 && day.d === E) settleAll(day.n[3], day.d);
        else closeAll(marketPricer(day, E, "c"), day.d);
        state = "done"; exitReason = exitReason || "Scheduled exit";
      }

      // tracking
      if (entryDate) {
        rangePct = Math.max(rangePct, Math.abs(day.n[1] / spotEntry - 1) * 100, Math.abs(day.n[2] / spotEntry - 1) * 100);
      }
      const s = shorts();
      if (open.length && s.ce && s.pe) {
        const appr = Math.min((s.ce - day.n[1]) / day.n[3], (day.n[2] - s.pe) / day.n[3]) * 100;
        closest = Math.min(closest, appr);
        if (appr <= 0) touched = true;
      }
      const contribution = realized - costs + (open.length ? mtm(marketPricer(day, E, "c")) : 0);
      worstMtm = Math.min(worstMtm, contribution);
      if (!isOpen) inc[di] += contribution - lastContribution;
      lastContribution = contribution;
      inPos[di] = inPos[di] || hadPosAtOpen || enteredToday || open.length > 0;
    }

    const exitDay = days[sessions[lastT]];
    const net = realized - costs;
    const allLegs = [...closedLegs, ...open];
    const evStart = planned.d, evEnd = exitDay.d;
    const record: CycleResult = {
      expiry: E,
      expiryWeekday: WEEKDAYS[new Date(E + "T00:00:00Z").getUTCDay()],
      plannedEntry: planned.d,
      entryDate,
      exitDate: exitDay.d,
      skipped: entryDate ? null : skipped ?? "No entry",
      lots, lotSize,
      legs: allLegs,
      initialCE, initialPE,
      premiumCollected: premium,
      grossPnl: realized,
      costs,
      netPnl: entryDate ? net : 0,
      returnPct: entryDate ? (net / cap) * 100 : 0,
      adjustments,
      spotEntry: spotEntry || planned.n[0],
      spotExit: exitDay.n[3],
      niftyMovePct: ((exitDay.n[3] / (spotEntry || planned.n[0])) - 1) * 100,
      niftyRangePct: rangePct,
      vixEntry: vixEntry || vixOf(planned, "o"),
      worstMtm,
      touchedStrike: touched,
      closestApproachPct: Number.isFinite(closest) ? closest : 0,
      events: MARKET_EVENTS.filter((e) => e.d >= evStart && e.d <= evEnd).map((e) => e.label),
      exitReason: entryDate ? exitReason : "",
      estimatedPrices: estimated,
      marginUsed: spec.wings.enabled || spec.structure === "iron_condor"
        ? Math.min(notional * spec.sizing.marginPctOfNotional / 100, notional * (spec.wings.distancePercent || 2) / 100 * 1.1) * lots
        : notional * spec.sizing.marginPctOfNotional / 100 * lots,
    };
    if (isOpen) {
      openCycle = {
        expiry: E, state, asOf: exitDay.d, openLegs: open, cycle: record, sessionsLeft: exitT - lastT, qty, lots, lotSize,
        netSoFar: lastContribution, adjustments,
      };
    } else cycles.push(record);
  }

  // equity curve
  const daily: DailyPoint[] = [];
  let eq = cap;
  const n0 = days[0]?.n[3] ?? 1;
  days.forEach((d, i) => {
    eq += inc[i];
    daily.push({ d: d.d, equity: eq, nifty: d.n[3], benchmark: cap * d.n[3] / n0, inPos: inPos[i] });
  });

  const est = cycles.reduce((a, c) => a + c.estimatedPrices, 0);
  if (est > 0) warnings.push(`${est} option prices were estimated (strike didn't trade at that moment, or an intraday adjustment).`);
  if (spec.intradayFill === "intraday") warnings.push("Intraday adjustments are priced with an implied-volatility model because daily data doesn't show the exact intraday price.");
  return { spec, cycles, daily, start: days[0]?.d ?? from, end: days[days.length - 1]?.d ?? to, warnings, openCycle };
}
