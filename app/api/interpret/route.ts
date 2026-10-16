import { aiEnabled, callTool } from "@/lib/llm";
import { INTERPRET_SCHEMA } from "@/lib/schema";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM = `You convert an Indian options trader's description of a Nifty strategy (often a transcribed voice note, so expect filler words and transcription errors like "adding money" for "at-the-money") into a precise, testable strategy specification for a daily-data backtester.

Market facts you must use:
- Nifty weekly options expired on Thursday until August 2025 and on Tuesday from September 2025. The backtester always counts in trading sessions relative to the actual expiry, so "Wednesday after Tuesday expiry" = daysAfterExpiry 1, "Monday before Tuesday expiry" = daysBeforeExpiry 1.
- Morning entries (9:15–10:00) use entryPrice "open". Exits at 3:15–3:30 are the close.
- "0.1% per day" over a cycle from the day after expiry to the day before expiry ≈ 5 sessions ≈ 0.5% per cycle → targetPremiumPct 0.5. If the trader states a weekly goal, prefer that.
- "Comfortable strikes" that "don't come close to the money" → a comfort floor (minOtmPercent). Use 1.5 if no number is given.
- "Big gap up or gap down" → gapAdjustPct 1 unless stated. "Comes close to the strike" → breachBufferPct 0.5 unless stated, with intradayFill "intraday" when the trader expects it to happen automatically.
- "Create new positions that compensate for the loss" → adjustAction roll_cover_loss.
- Lot sizes, STT, exchange charges and expiry-day changes are handled by the engine; do not mention them as assumptions.

Keep the capital and sizing the user's form provides unless the trader explicitly says otherwise. Fill every field. Be faithful to what the trader said; do not "improve" the strategy here. Write the understanding bullets in simple English a non-technical trader in India would follow, using ₹ and %.`;

export async function POST(req: Request) {
  if (!aiEnabled()) return Response.json({ error: "no_key" }, { status: 503 });
  const { text, currentSpec } = await req.json();
  if (!text || String(text).trim().length < 15) return Response.json({ error: "Please describe the strategy in a sentence or two." }, { status: 400 });
  try {
    const { data, model } = await callTool<any>({
      kind: "fast",
      system: SYSTEM,
      user: `Current form values (keep sizing.capital, sizing.mode, sizing.lots and costs unless the trader overrides them):\n${JSON.stringify(currentSpec ?? {}, null, 1)}\n\nThe trader's strategy:\n"""${String(text).slice(0, 6000)}"""`,
      toolName: "strategy_spec",
      toolDescription: "Return the structured strategy specification and a plain-English explanation of how it was understood.",
      schema: INTERPRET_SCHEMA,
      maxTokens: 3000,
    });
    return Response.json({ ...data, model });
  } catch (e: any) {
    return Response.json({ error: e.message ?? "AI error" }, { status: 500 });
  }
}
