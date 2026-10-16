// JSON schema of StrategySpec for Claude tool-use. Descriptions double as instructions to the model.
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });

export const SPEC_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short friendly name for the strategy (max 6 words)" },
    description: { type: "string", description: "One-paragraph plain-English restatement of the strategy as you understood it" },
    structure: { type: "string", enum: ["strangle", "straddle", "iron_condor"], description: "Short strangle (OTM call + OTM put sold), short straddle (ATM both), or iron condor (strangle plus bought wings)" },
    entry: {
      type: "object",
      properties: {
        daysAfterExpiry: num("Trading days after the previous weekly expiry to enter. 1 = first session after expiry (Wednesday when expiry is Tuesday; Friday when expiry was Thursday). 0 = on the expiry day itself"),
        retryIfPremiumShort: bool("If the target premium isn't available at comfortable strikes, try again the next day"),
        lastEntryDaysBeforeExit: num("Stop trying to enter when fewer than this many sessions remain before the exit day. Usually 1"),
        entryPrice: { type: "string", enum: ["open", "close"], description: "'open' for morning entries (9:15–10:00), 'close' for afternoon entries" },
      },
      required: ["daysAfterExpiry", "retryIfPremiumShort", "lastEntryDaysBeforeExit", "entryPrice"],
    },
    exit: {
      type: "object",
      properties: {
        daysBeforeExpiry: num("Exit at the close this many trading days before expiry. 1 = the session before expiry (Monday for Tuesday expiry). 0 = hold into expiry"),
      },
      required: ["daysBeforeExpiry"],
    },
    strikes: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["target_premium", "otm_percent", "sd_move"], description: "target_premium = pick the farthest strikes that still collect the target premium; otm_percent = fixed % away from Nifty; sd_move = multiple of the VIX-implied expected move" },
        targetPremiumPct: num("Total premium (call + put) to collect per weekly cycle, as % of capital. E.g. '0.1% per day' over a 5-day week = 0.5"),
        otmPercent: num("For otm_percent: distance of each short strike from Nifty in %"),
        sdMultiple: num("For sd_move: distance as a multiple of the expected move to expiry"),
        minOtmPercent: num("Comfort floor: never sell a strike closer than this % from Nifty. If the trader says 'comfortable' without a number, use 1.5"),
      },
      required: ["method", "targetPremiumPct", "otmPercent", "sdMultiple", "minOtmPercent"],
    },
    wings: {
      type: "object",
      properties: {
        enabled: bool("Buy protective far-OTM options (hedges) beyond the short strikes"),
        distancePercent: num("How far beyond each short strike the hedge is bought, in % of the strike"),
      },
      required: ["enabled", "distancePercent"],
    },
    sizing: {
      type: "object",
      properties: {
        capital: num("Trading capital in rupees (₹). Keep the value provided by the user's form unless they say otherwise"),
        mode: { type: "string", enum: ["auto_capital", "fixed_lots"], description: "auto_capital = as many lots as the capital's margin allows; fixed_lots = a fixed number of lots" },
        lots: num("Number of lots when mode is fixed_lots"),
        marginPctOfNotional: num("Estimated margin per lot as % of notional. Naked Nifty strangle ≈ 9"),
      },
      required: ["capital", "mode", "lots", "marginPctOfNotional"],
    },
    risk: {
      type: "object",
      properties: {
        gapAdjustPct: num("Adjust if Nifty opens at least this % away from the previous close. 'Big gap' without a number = 1. 0 = no gap rule"),
        breachBufferPct: num("Adjust when Nifty comes within this % of a short strike. 'Comes close to the strike' without a number = 0.5. Use -1 to disable"),
        adjustAction: { type: "string", enum: ["roll_cover_loss", "roll_same", "exit"], description: "roll_cover_loss = close and open a new strangle sized to recover the loss so far; roll_same = close and re-sell for the normal remaining target; exit = close and stay out for the week" },
        maxAdjustmentsPerCycle: num("Maximum adjustments per week. If unspecified use 2"),
        afterMaxAdjust: { type: "string", enum: ["exit", "hold"], description: "What to do when a trigger fires after all adjustments are used up" },
        adjustMinOtmPercent: num("Comfort floor when re-entering after an adjustment, in %. If unspecified use 1"),
        stopLossPctOfCapital: num("Hard weekly stop-loss as % of capital. 0 = none"),
        takeProfitPctOfPremium: num("Book profit early when this % of the collected premium has decayed. 0 = none"),
      },
      required: ["gapAdjustPct", "breachBufferPct", "adjustAction", "maxAdjustmentsPerCycle", "afterMaxAdjust", "adjustMinOtmPercent", "stopLossPctOfCapital", "takeProfitPctOfPremium"],
    },
    costs: {
      type: "object",
      properties: {
        brokeragePerOrder: num("Brokerage in ₹ per executed order (Zerodha = 20)"),
        slippagePct: num("Slippage as % of option price per fill. Default 1"),
        taxRatePct: num("Income-tax slab rate applied to F&O profits (business income). Default 30"),
      },
      required: ["brokeragePerOrder", "slippagePct", "taxRatePct"],
    },
    weeklyTargetPct: num("The trader's weekly return goal in % of capital"),
    intradayFill: { type: "string", enum: ["intraday", "close"], description: "Use 'intraday' when adjustments should happen as soon as a level is touched; 'close' when the trader only checks near 3:30" },
  },
  required: ["name", "description", "structure", "entry", "exit", "strikes", "wings", "sizing", "risk", "costs", "weeklyTargetPct", "intradayFill"],
};

export const INTERPRET_SCHEMA = {
  type: "object",
  properties: {
    spec: SPEC_SCHEMA,
    understanding: {
      type: "array",
      items: { type: "string" },
      description: "4–7 short bullet points, in plain English a trader would use, describing exactly what the backtest will do (entry, strikes, adjustments, exit, sizing). Mention concrete numbers.",
    },
    assumptions: {
      type: "array",
      items: { type: "string" },
      description: "Every place where the trader was vague and you picked a number or rule. Format: '<what was vague> → I assumed <value> because <reason>'.",
    },
    questions: {
      type: "array",
      items: { type: "string" },
      description: "Up to 3 short questions whose answers would change the result most",
    },
    unsupported: {
      type: "array",
      items: { type: "string" },
      description: "Parts of the strategy this backtester cannot model with daily data (e.g. exact minute-level timing), and how it approximates them",
    },
  },
  required: ["spec", "understanding", "assumptions", "questions", "unsupported"],
};

export const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One punchy sentence verdict (max 25 words) a trader would remember" },
    verdict: { type: "string", description: "3–4 sentences: does the strategy meet its goal, at what risk, and is the risk worth it" },
    grade: { type: "string", enum: ["A", "B", "C", "D", "F"], description: "Overall grade considering return, risk, and consistency vs the trader's goal" },
    works: { type: "array", items: { type: "string" }, description: "3–5 specific conditions where the strategy works, citing numbers from the data" },
    fails: { type: "array", items: { type: "string" }, description: "3–5 specific conditions/episodes where it suffers, citing dates and numbers" },
    gaps: { type: "array", items: { type: "string" }, description: "3–5 gaps or hidden risks in the rules themselves (e.g. no hard stop, whipsaw from loss-recovery rolling, tail risk vs small gains)" },
    suggestions: {
      type: "array",
      description: "3–4 concrete, testable changes. Each must be expressible as a change to the spec fields.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short imperative title, e.g. 'Add a 1.5% weekly stop-loss'" },
          why: { type: "string", description: "One sentence on why this should help, referring to the evidence" },
          patch: { type: "object", description: "Partial StrategySpec containing ONLY the fields to change, using the exact same nested structure and field names", additionalProperties: true },
        },
        required: ["title", "why", "patch"],
      },
    },
  },
  required: ["headline", "verdict", "grade", "works", "fails", "gaps", "suggestions"],
};
