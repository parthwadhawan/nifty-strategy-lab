import { aiEnabled, callTool } from "@/lib/llm";
import { ANALYSIS_SCHEMA } from "@/lib/schema";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const SYSTEM = `You are a seasoned Indian derivatives risk manager reviewing a 5-year backtest of a trader's Nifty weekly option-selling strategy. The reader is the trader himself — experienced in markets, not in statistics. Be direct, specific and kind. Cite actual numbers, dates and market events from the data provided. Avoid jargon; when you must use a term (drawdown, Sharpe), explain it in a few words. Never promise future returns.

Important context:
- Results come from daily NSE bhavcopy data (open/high/low/close per option). Intraday adjustments are estimated with an implied-volatility model; mention this only if it materially affects conclusions.
- Short option strategies typically win often and lose big occasionally (negative skew). Judge whether the occasional big loss wipes out many weeks of gains.
- F&O profits are taxed as business income at slab rate.
- Suggestions must be concrete changes to the spec fields provided (use the exact field names and nesting), small enough to test. Good ideas include: a weekly stop-loss, wider comfort floor, VIX-aware sizing via lower target, capping adjustments, switching roll_cover_loss to roll_same or exit, buying wings, profit booking. Do not suggest things the spec cannot express.`;

export async function POST(req: Request) {
  if (!aiEnabled()) return Response.json({ error: "no_key" }, { status: 503 });
  const body = await req.json();
  try {
    const { data, model } = await callTool<any>({
      kind: "deep",
      system: SYSTEM,
      user: `Strategy spec:\n${JSON.stringify(body.spec, null, 1)}\n\nBacktest summary:\n${JSON.stringify(body.summary, null, 1)}`,
      toolName: "strategy_review",
      toolDescription: "Return the structured review of the backtest.",
      schema: ANALYSIS_SCHEMA,
      maxTokens: 4000,
    });
    return Response.json({ ...data, model });
  } catch (e: any) {
    return Response.json({ error: e.message ?? "AI error" }, { status: 500 });
  }
}
